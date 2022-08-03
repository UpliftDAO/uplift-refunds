import { BytesLike } from '@ethersproject/bytes'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address'
import { expect } from 'chai'
import { ethers } from 'hardhat'
import {
  ERC1967Proxy,
  ERC1967Proxy__factory,
  OneChainRefundClaimer,
  OneChainRefundClaimer__factory,
  Registry,
  Registry__factory,
  TestERC20,
  TestERC20__factory,
  TestReferralPool__factory,
  TestRefundIDO,
  TestRefundIDO__factory,
  TestRefundRequester,
  TestRefundRequester__factory,
  UpgradedOneChainRefundClaimer,
  UpgradedOneChainRefundClaimer__factory
} from '../typechain'
import { days } from '../utils/time'
import { expandTo18Decimals, latestBlockTimestamp, toUQ112 } from '../utils/utilities'

type ClaimRefundData = {
  data: BytesLike
  identifier: string
  token: string
}

type KPI = {
  dateRequestStart: number
  dateRequestEnd: number
  percentInBP: number
  multiplierInBP: number
  isFullRefund: boolean
  isRefundable: boolean
}

describe('OneChainRefundClaimer', () => {
  let owner: SignerWithAddress
  let user: SignerWithAddress
  let inactiveUser: SignerWithAddress
  let claimer: SignerWithAddress

  let registry: Registry

  let refundClaimer: OneChainRefundClaimer
  let buyToken: TestERC20
  let proxy: ERC1967Proxy

  let claimRefundData: ClaimRefundData[]

  let ido: TestRefundIDO
  let refundRequester: TestRefundRequester
  let IDOToken: TestERC20
  let KPIs: KPI[]

  const contractAmountInIDOToken = expandTo18Decimals(1000)
  const userAmountInIDOToken = expandTo18Decimals(100)
  const userAmountInBuyToken = expandTo18Decimals(50)
  const BP = 10_000

  beforeEach(async () => {
    ;[owner, claimer, user, inactiveUser] = await ethers.getSigners()

    registry = await new Registry__factory(owner).deploy(owner.address)

    buyToken = await new TestERC20__factory(owner).deploy('BUSD', 'BUSD', expandTo18Decimals(1_000_000))
    IDOToken = await new TestERC20__factory(owner).deploy('IDO Token', 'IDO_TKN', expandTo18Decimals(1_000_000))
    const now = await latestBlockTimestamp(ethers.provider)
    KPIs = [
      {
        dateRequestStart: now,
        dateRequestEnd: now + days(1),
        percentInBP: BP,
        multiplierInBP: BP,
        isFullRefund: true,
        isRefundable: true
      }
    ]
    refundRequester = await new TestRefundRequester__factory(owner).deploy(KPIs, IDOToken.address)

    const referralPool = await new TestReferralPool__factory(owner).deploy()
    ido = await new TestRefundIDO__factory(owner).deploy()
    const priceTokenPerBuyTokenInUQ = toUQ112(userAmountInBuyToken).div(userAmountInIDOToken)
    await ido.setBaseInfo(referralPool.address, priceTokenPerBuyTokenInUQ)
    await ido.addAccount(user.address, userAmountInIDOToken, ethers.constants.AddressZero, ethers.constants.AddressZero)

    // Deploy claimer
    refundClaimer = await new OneChainRefundClaimer__factory(owner).deploy()

    proxy = await new ERC1967Proxy__factory(owner).deploy(
      refundClaimer.address,
      refundClaimer.interface.encodeFunctionData('initialize', [
        registry.address,
        buyToken.address,
        ido.address,
        ethers.utils.defaultAbiCoder.encode(['address', 'address'], [refundRequester.address, IDOToken.address])
      ])
    )
    refundClaimer = refundClaimer.attach(proxy.address)

    claimRefundData = [
      {
        data: ethers.utils.defaultAbiCoder.encode([], []),
        identifier: ido.address,
        token: buyToken.address
      }
    ]

    await buyToken.transfer(refundClaimer.address, contractAmountInIDOToken)
    await refundRequester.connect(user).testRequestRefund(userAmountInIDOToken, ido.address, false)

    const ROLE_REFUND_CLAIMER = await refundClaimer.ROLE_REFUND_CLAIMER()
    await registry.grantRole(ROLE_REFUND_CLAIMER, claimer.address)
  })

  describe('upgradeability', () => {
    let updatedClaimer: UpgradedOneChainRefundClaimer

    beforeEach(async () => {
      updatedClaimer = await new UpgradedOneChainRefundClaimer__factory(owner).deploy()
    })

    it('upgrade:successfully', async () => {
      const refundRequesterInfo = await refundClaimer
        .attach(proxy.address)
        .requesterInfoOf(buyToken.address, ido.address)
      expect(refundRequesterInfo.refundRequester).to.eq(refundRequester.address)
      expect(refundRequesterInfo.IDOToken).to.eq(IDOToken.address)
      await refundClaimer.upgradeTo(updatedClaimer.address)
      const refundRequesterInfo2 = await updatedClaimer
        .attach(proxy.address)
        .requesterInfoOf(buyToken.address, ido.address)
      expect(refundRequesterInfo2.refundRequester).to.eq(refundRequester.address)
      expect(refundRequesterInfo2.IDOToken).to.eq(IDOToken.address)
      expect(await updatedClaimer.attach(proxy.address).test()).to.eq('Success')
    })

    it('upgrade:forbidden', async () => {
      await expect(refundClaimer.connect(user).upgradeTo(updatedClaimer.address)).to.revertedWith('BRC:F')
    })
  })

  describe('setters', () => {
    let IDOToken2: TestERC20
    let refundRequester2: TestRefundRequester

    beforeEach(async () => {
      IDOToken2 = await new TestERC20__factory(owner).deploy('IDO Token 2', 'IDO_TKN2', expandTo18Decimals(1_000_000))
      refundRequester2 = await new TestRefundRequester__factory(owner).deploy(KPIs, IDOToken2.address)
    })

    it('setRefundRequester:forbidden', async () => {
      await expect(
        refundClaimer.connect(user).setRefundRequester(IDOToken2.address, ido.address, refundRequester2.address)
      ).to.revertedWith('BRC:F')
    })

    it('setRefundRequester:wrong address', async () => {
      await expect(refundClaimer.setRefundRequester(IDOToken2.address, ido.address, ido.address)).to.revertedWith(
        'OCRC:I'
      )
    })

    it('setRefundRequester:success', async () => {
      await expect(refundClaimer.setRefundRequester(IDOToken2.address, ido.address, refundRequester2.address))
        .to.emit(refundClaimer, 'SetRefundRequester')
        .withArgs(IDOToken2.address, ido.address, refundRequester2.address)
      const refundRequesterInfo = await refundClaimer
        .attach(proxy.address)
        .requesterInfoOf(IDOToken2.address, ido.address)
      expect(refundRequesterInfo.refundRequester).to.eq(refundRequester2.address)
    })

    it('setIDOToken:forbidden', async () => {
      await expect(
        refundClaimer.connect(user).setIDOToken(IDOToken2.address, ido.address, refundRequester2.address)
      ).to.revertedWith('BRC:F')
    })

    it('setIDOToken:success', async () => {
      await expect(refundClaimer.setIDOToken(IDOToken2.address, ido.address, refundRequester2.address))
        .to.emit(refundClaimer, 'SetIDOToken')
        .withArgs(IDOToken2.address, ido.address, refundRequester2.address)
      const refundRequesterInfo = await refundClaimer
        .attach(proxy.address)
        .requesterInfoOf(IDOToken2.address, ido.address)
      expect(refundRequesterInfo.IDOToken).to.eq(refundRequester2.address)
    })
  })

  describe('claim refund', () => {
    it('claimRefundForAccount:forbidden', async () => {
      await expect(refundClaimer.claimRefundForAccount(user.address, claimRefundData)).to.revertedWith('BRC:F')
    })

    it('claimRefundForAccount:zero account address', async () => {
      await expect(
        refundClaimer.connect(claimer).claimRefundForAccount(ethers.constants.AddressZero, claimRefundData)
      ).to.revertedWith('BRC:Z')
    })

    it('claimRefundForAccount:success', async () => {
      await expect(refundClaimer.connect(claimer).claimRefundForAccount(user.address, claimRefundData))
        .to.emit(refundClaimer, 'ClaimRefund')
        .withArgs(claimer.address, buyToken.address, ido.address, user.address, userAmountInBuyToken)
      expect(await refundClaimer.refundClaimedInBuyToken(buyToken.address, ido.address, user.address)).to.eq(
        userAmountInBuyToken
      )
    })

    it('claimRefund:success', async () => {
      await expect(refundClaimer.connect(user).claimRefund(claimRefundData))
        .to.emit(refundClaimer, 'ClaimRefund')
        .withArgs(user.address, buyToken.address, ido.address, user.address, userAmountInBuyToken)
      expect(await refundClaimer.refundClaimedInBuyToken(buyToken.address, ido.address, user.address)).to.eq(
        userAmountInBuyToken
      )
      expect(await buyToken.balanceOf(user.address)).to.eq(userAmountInBuyToken)
    })

    it('claimRefundForAccount:user hasnt requested refund', async () => {
      await expect(
        refundClaimer.connect(claimer).claimRefundForAccount(inactiveUser.address, claimRefundData)
      ).to.not.emit(refundClaimer, 'ClaimRefund')
      expect(await refundClaimer.refundClaimedInBuyToken(buyToken.address, ido.address, user.address)).to.eq(0)
    })

    it('claimRefund:user hasnt requested refund', async () => {
      await expect(refundClaimer.connect(inactiveUser).claimRefund(claimRefundData)).to.not.emit(
        refundClaimer,
        'ClaimRefund'
      )
      expect(await refundClaimer.refundClaimedInBuyToken(buyToken.address, ido.address, inactiveUser.address)).to.eq(0)
      expect(await buyToken.balanceOf(user.address)).to.eq(0)
    })

    it('claimRefundForAccount:call claim second time without new refund requests', async () => {
      await expect(refundClaimer.connect(claimer).claimRefundForAccount(user.address, claimRefundData))
        .to.emit(refundClaimer, 'ClaimRefund')
        .withArgs(claimer.address, buyToken.address, ido.address, user.address, userAmountInBuyToken)
      expect(await refundClaimer.refundClaimedInBuyToken(buyToken.address, ido.address, user.address)).to.eq(
        userAmountInBuyToken
      )
      expect(await buyToken.balanceOf(user.address)).to.eq(userAmountInBuyToken)

      await expect(refundClaimer.connect(claimer).claimRefundForAccount(user.address, claimRefundData)).to.not.emit(
        refundClaimer,
        'ClaimRefund'
      )
      expect(await refundClaimer.refundClaimedInBuyToken(buyToken.address, ido.address, user.address)).to.eq(
        userAmountInBuyToken
      )
      expect(await buyToken.balanceOf(user.address)).to.eq(userAmountInBuyToken)
    })

    it('claimRefundForAccount:successfull call claim second time with new refund request', async () => {
      await expect(refundClaimer.connect(claimer).claimRefundForAccount(user.address, claimRefundData))
        .to.emit(refundClaimer, 'ClaimRefund')
        .withArgs(claimer.address, buyToken.address, ido.address, user.address, userAmountInBuyToken)
      expect(await buyToken.balanceOf(user.address)).to.eq(userAmountInBuyToken)

      // second requestRefund
      await refundRequester.connect(user).testRequestRefund(userAmountInIDOToken, ido.address, false)

      await expect(refundClaimer.connect(claimer).claimRefundForAccount(user.address, claimRefundData))
        .to.emit(refundClaimer, 'ClaimRefund')
        .withArgs(claimer.address, buyToken.address, ido.address, user.address, userAmountInBuyToken)

      const total = userAmountInBuyToken.add(userAmountInBuyToken)
      expect(await refundClaimer.refundClaimedInBuyToken(buyToken.address, ido.address, user.address)).to.eq(total)
      expect(await buyToken.balanceOf(user.address)).to.eq(total)
    })

    it('claimRefundForAccount:fakeToken token-identifier pair', async () => {
      const fakeToken = await new TestERC20__factory(owner).deploy(
        'IDO Token',
        'IDO_TKN',
        expandTo18Decimals(1_000_000)
      )
      claimRefundData = [
        {
          data: ethers.utils.defaultAbiCoder.encode([], []),
          identifier: ido.address,
          token: fakeToken.address
        }
      ]
      await expect(refundClaimer.connect(claimer).claimRefundForAccount(user.address, claimRefundData)).to.revertedWith(
        'BRC:I'
      )
    })

    it('claimRefundForAccount:fakeIDO token-identifier pair', async () => {
      const fakeIDO = await new TestRefundIDO__factory(owner).deploy()
      claimRefundData = [
        {
          data: ethers.utils.defaultAbiCoder.encode([], []),
          identifier: fakeIDO.address,
          token: buyToken.address
        }
      ]
      await expect(refundClaimer.connect(claimer).claimRefundForAccount(user.address, claimRefundData)).to.revertedWith(
        'BRC:I'
      )
    })

    it('claimRefund:successfully claim from two refund requesters', async () => {
      const buyToken2 = await new TestERC20__factory(owner).deploy('BUSD2', 'BUSD2', expandTo18Decimals(1_000_000))
      const IDOToken2 = await new TestERC20__factory(owner).deploy(
        'IDO Token 2',
        'IDO_TKN2',
        expandTo18Decimals(1_000_000)
      )
      claimRefundData = [
        {
          data: ethers.utils.defaultAbiCoder.encode([], []),
          identifier: ido.address,
          token: buyToken.address
        },
        {
          data: ethers.utils.defaultAbiCoder.encode([], []),
          identifier: ido.address,
          token: buyToken2.address
        }
      ]
      await buyToken2.transfer(refundClaimer.address, contractAmountInIDOToken)
      const refundRequester2 = await new TestRefundRequester__factory(owner).deploy(KPIs, IDOToken2.address)
      await refundRequester2.connect(user).testRequestRefund(userAmountInIDOToken, ido.address, false)

      await refundClaimer.setRefundRequester(buyToken2.address, ido.address, refundRequester2.address)

      await expect(refundClaimer.connect(user).claimRefund(claimRefundData))
        .to.emit(refundClaimer, 'ClaimRefund')
        .withArgs(user.address, buyToken.address, ido.address, user.address, userAmountInBuyToken)
        .to.emit(refundClaimer, 'ClaimRefund')
        .withArgs(user.address, buyToken2.address, ido.address, user.address, userAmountInBuyToken)
      expect(await refundClaimer.refundClaimedInBuyToken(buyToken2.address, ido.address, user.address)).to.eq(
        userAmountInBuyToken
      )
      expect(await buyToken.balanceOf(user.address)).to.eq(userAmountInBuyToken)
      expect(await refundClaimer.refundClaimedInBuyToken(buyToken2.address, ido.address, user.address)).to.eq(
        userAmountInBuyToken
      )
      expect(await buyToken2.balanceOf(user.address)).to.eq(userAmountInBuyToken)
    })
  })
})
