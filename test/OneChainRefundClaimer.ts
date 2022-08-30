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
import { TestDeflationaryERC20__factory } from './../typechain/factories/TestDeflationaryERC20__factory'
import { TestDeflationaryERC20 } from './../typechain/TestDeflationaryERC20.d'

type ClaimRefundData = {
  data: BytesLike
  identifier: string
  token: string
  KPIIndices: number[]
}

type KPI = {
  dateRequestStart: number
  dateRequestEnd: number
  percentInBP: number
  multiplierInBP: number
  isFullRefund: boolean
  isRefundable: boolean
  isClaimable: boolean
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
        isRefundable: true,
        isClaimable: true
      }
    ]
    refundRequester = await new TestRefundRequester__factory(owner).deploy(KPIs, IDOToken.address)

    const referralPool = await new TestReferralPool__factory(owner).deploy()
    ido = await new TestRefundIDO__factory(owner).deploy()
    const priceTokenPerBuyTokenInUQ = toUQ112(userAmountInIDOToken).div(userAmountInBuyToken)
    await ido.setBaseInfo(referralPool.address, priceTokenPerBuyTokenInUQ, buyToken.address)
    await ido.addAccount(user.address, userAmountInIDOToken, ethers.constants.AddressZero, ethers.constants.AddressZero)

    // Deploy claimer
    refundClaimer = await new OneChainRefundClaimer__factory(owner).deploy()

    proxy = await new ERC1967Proxy__factory(owner).deploy(
      refundClaimer.address,
      refundClaimer.interface.encodeFunctionData('initialize', [
        registry.address,
        IDOToken.address,
        ido.address,
        ethers.utils.defaultAbiCoder.encode(['address'], [refundRequester.address])
      ])
    )
    refundClaimer = refundClaimer.attach(proxy.address)

    claimRefundData = [
      {
        data: ethers.utils.defaultAbiCoder.encode([], []),
        identifier: ido.address,
        token: IDOToken.address,
        KPIIndices: [0]
      }
    ]

    await buyToken.transfer(refundClaimer.address, contractAmountInIDOToken)
    await refundRequester
      .connect(user)
      .testRequestRefund(userAmountInIDOToken, userAmountInIDOToken, ido.address, false)

    const ROLE_REFUND_CLAIMER = await refundClaimer.ROLE_REFUND_CLAIMER()
    await registry.grantRole(ROLE_REFUND_CLAIMER, claimer.address)
  })

  describe('upgradeability', () => {
    let updatedClaimer: UpgradedOneChainRefundClaimer

    beforeEach(async () => {
      updatedClaimer = await new UpgradedOneChainRefundClaimer__factory(owner).deploy()
    })

    it('upgrade:successfully', async () => {
      const refundRequesterFromSC = await refundClaimer
        .attach(proxy.address)
        .refundRequesterOf(IDOToken.address, ido.address)
      expect(refundRequesterFromSC).to.eq(refundRequester.address)
      await refundClaimer.upgradeTo(updatedClaimer.address)
      const refundRequesterFromSC2 = await updatedClaimer
        .attach(proxy.address)
        .refundRequesterOf(IDOToken.address, ido.address)
      expect(refundRequesterFromSC2).to.eq(refundRequester.address)
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
        .refundRequesterOf(IDOToken2.address, ido.address)
      expect(refundRequesterInfo).to.eq(refundRequester2.address)
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
        .withArgs(
          claimer.address,
          IDOToken.address,
          ido.address,
          user.address,
          userAmountInBuyToken,
          userAmountInBuyToken
        )
      expect(await refundClaimer.refundClaimedByKPIInIDOToken(IDOToken.address, ido.address, user.address, [0])).to.eq(
        userAmountInIDOToken
      )
      const info = await refundClaimer.infoOf(IDOToken.address, ido.address, user.address, [0])
      expect(info[0].refundClaimedByKPIInIDOToken).to.eq(userAmountInIDOToken)
    })

    it('claimRefund:success', async () => {
      await expect(refundClaimer.connect(user).claimRefund(claimRefundData))
        .to.emit(refundClaimer, 'ClaimRefund')
        .withArgs(user.address, IDOToken.address, ido.address, user.address, userAmountInBuyToken, userAmountInBuyToken)
      expect(await refundClaimer.refundClaimedByKPIInIDOToken(IDOToken.address, ido.address, user.address, [0])).to.eq(
        userAmountInIDOToken
      )
      const info = await refundClaimer.infoOf(IDOToken.address, ido.address, user.address, [0])
      expect(info[0].refundClaimedByKPIInIDOToken).to.eq(userAmountInIDOToken)
      expect(await buyToken.balanceOf(user.address)).to.eq(userAmountInBuyToken)
    })

    it('claimRefundForAccount:user has not requested refund', async () => {
      await expect(
        refundClaimer.connect(claimer).claimRefundForAccount(inactiveUser.address, claimRefundData)
      ).to.not.emit(refundClaimer, 'ClaimRefund')
      expect(await refundClaimer.refundClaimedByKPIInIDOToken(IDOToken.address, ido.address, user.address, [0])).to.eq(
        0
      )
    })

    it('claimRefund:user has not requested refund', async () => {
      await expect(refundClaimer.connect(inactiveUser).claimRefund(claimRefundData)).to.not.emit(
        refundClaimer,
        'ClaimRefund'
      )
      expect(
        await refundClaimer.refundClaimedByKPIInIDOToken(IDOToken.address, ido.address, inactiveUser.address, [0])
      ).to.eq(0)
      expect(await buyToken.balanceOf(user.address)).to.eq(0)
    })

    it('claimRefundForAccount:call claim second time without new refund requests', async () => {
      await expect(refundClaimer.connect(claimer).claimRefundForAccount(user.address, claimRefundData))
        .to.emit(refundClaimer, 'ClaimRefund')
        .withArgs(
          claimer.address,
          IDOToken.address,
          ido.address,
          user.address,
          userAmountInBuyToken,
          userAmountInBuyToken
        )
      expect(await refundClaimer.refundClaimedByKPIInIDOToken(IDOToken.address, ido.address, user.address, [0])).to.eq(
        userAmountInIDOToken
      )
      expect(await buyToken.balanceOf(user.address)).to.eq(userAmountInBuyToken)

      await expect(refundClaimer.connect(claimer).claimRefundForAccount(user.address, claimRefundData)).to.not.emit(
        refundClaimer,
        'ClaimRefund'
      )
      expect(await refundClaimer.refundClaimedByKPIInIDOToken(IDOToken.address, ido.address, user.address, [0])).to.eq(
        userAmountInIDOToken
      )
      expect(await buyToken.balanceOf(user.address)).to.eq(userAmountInBuyToken)
    })

    it('claimRefundForAccount:successfull call claim second time with new refund request', async () => {
      await expect(refundClaimer.connect(claimer).claimRefundForAccount(user.address, claimRefundData))
        .to.emit(refundClaimer, 'ClaimRefund')
        .withArgs(
          claimer.address,
          IDOToken.address,
          ido.address,
          user.address,
          userAmountInBuyToken,
          userAmountInBuyToken
        )
      expect(await buyToken.balanceOf(user.address)).to.eq(userAmountInBuyToken)

      // second requestRefund
      await refundRequester
        .connect(user)
        .testRequestRefund(userAmountInIDOToken, userAmountInIDOToken, ido.address, false)

      await expect(refundClaimer.connect(claimer).claimRefundForAccount(user.address, claimRefundData))
        .to.emit(refundClaimer, 'ClaimRefund')
        .withArgs(
          claimer.address,
          IDOToken.address,
          ido.address,
          user.address,
          userAmountInBuyToken,
          userAmountInBuyToken
        )

      const total = userAmountInBuyToken.add(userAmountInBuyToken)
      const totalInIDOToken = userAmountInIDOToken.add(userAmountInIDOToken)
      expect(await refundClaimer.refundClaimedByKPIInIDOToken(IDOToken.address, ido.address, user.address, [0])).to.eq(
        totalInIDOToken
      )
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
          token: fakeToken.address,
          KPIIndices: [0]
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
          token: buyToken.address,
          KPIIndices: [0]
        }
      ]
      await expect(refundClaimer.connect(claimer).claimRefundForAccount(user.address, claimRefundData)).to.revertedWith(
        'BRC:I'
      )
    })

    it('claimRefund:successfully claim from two refund requesters', async () => {
      const IDOToken2 = await new TestERC20__factory(owner).deploy(
        'IDO Token 2',
        'IDO_TKN2',
        expandTo18Decimals(1_000_000)
      )
      claimRefundData = [
        {
          data: ethers.utils.defaultAbiCoder.encode([], []),
          identifier: ido.address,
          token: IDOToken.address,
          KPIIndices: [0]
        },
        {
          data: ethers.utils.defaultAbiCoder.encode([], []),
          identifier: ido.address,
          token: IDOToken2.address,
          KPIIndices: [0]
        }
      ]
      await buyToken.transfer(refundClaimer.address, contractAmountInIDOToken)
      const refundRequester2 = await new TestRefundRequester__factory(owner).deploy(KPIs, IDOToken2.address)
      await refundRequester2
        .connect(user)
        .testRequestRefund(userAmountInIDOToken, userAmountInIDOToken, ido.address, false)

      await refundClaimer.setRefundRequester(IDOToken2.address, ido.address, refundRequester2.address)

      await expect(refundClaimer.connect(user).claimRefund(claimRefundData))
        .to.emit(refundClaimer, 'ClaimRefund')
        .withArgs(user.address, IDOToken.address, ido.address, user.address, userAmountInBuyToken, userAmountInBuyToken)
        .to.emit(refundClaimer, 'ClaimRefund')
        .withArgs(
          user.address,
          IDOToken2.address,
          ido.address,
          user.address,
          userAmountInBuyToken,
          userAmountInBuyToken
        )
      expect(await refundClaimer.refundClaimedByKPIInIDOToken(IDOToken2.address, ido.address, user.address, [0])).to.eq(
        userAmountInIDOToken
      )
      expect(await refundClaimer.refundClaimedByKPIInIDOToken(IDOToken2.address, ido.address, user.address, [0])).to.eq(
        userAmountInIDOToken
      )
      expect(await buyToken.balanceOf(user.address)).to.eq(userAmountInBuyToken.mul(2))
    })

    describe('few KPIs', () => {
      beforeEach(async () => {
        const now = await latestBlockTimestamp(ethers.provider)
        const percentInBP = 2_500 // 25%
        KPIs = [
          {
            dateRequestStart: now,
            dateRequestEnd: now + days(1),
            percentInBP: percentInBP,
            multiplierInBP: BP,
            isFullRefund: true,
            isRefundable: true,
            isClaimable: true
          },
          {
            dateRequestStart: now + days(2),
            dateRequestEnd: now + days(3),
            percentInBP: percentInBP,
            multiplierInBP: BP,
            isFullRefund: true,
            isRefundable: true,
            isClaimable: true
          },
          {
            dateRequestStart: now + days(3),
            dateRequestEnd: now + days(4),
            percentInBP: percentInBP,
            multiplierInBP: BP,
            isFullRefund: true,
            isRefundable: true,
            isClaimable: true
          },
          {
            dateRequestStart: now + days(4),
            dateRequestEnd: now + days(5),
            percentInBP: percentInBP,
            multiplierInBP: BP,
            isFullRefund: true,
            isRefundable: true,
            isClaimable: true
          }
        ]
        refundRequester = await new TestRefundRequester__factory(owner).deploy(KPIs, IDOToken.address)
        refundClaimer = await new OneChainRefundClaimer__factory(owner).deploy()

        proxy = await new ERC1967Proxy__factory(owner).deploy(
          refundClaimer.address,
          refundClaimer.interface.encodeFunctionData('initialize', [
            registry.address,
            IDOToken.address,
            ido.address,
            ethers.utils.defaultAbiCoder.encode(['address'], [refundRequester.address])
          ])
        )
        refundClaimer = refundClaimer.attach(proxy.address)

        await buyToken.transfer(refundClaimer.address, contractAmountInIDOToken)

        const ROLE_REFUND_CLAIMER = await refundClaimer.ROLE_REFUND_CLAIMER()
        await registry.grantRole(ROLE_REFUND_CLAIMER, claimer.address)

        await refundRequester.connect(user).setCurrentKPIIndex(0)
        await refundRequester
          .connect(user)
          .testRequestRefund(userAmountInIDOToken.div(4), userAmountInIDOToken.div(4), ido.address, false)

        await refundRequester.connect(user).setCurrentKPIIndex(3)
        await refundRequester
          .connect(user)
          .testRequestRefund(userAmountInIDOToken.div(4), userAmountInIDOToken.div(4), ido.address, false)
      })

      it('few KPIs:claimRefundForAccount:successfull call claim for few KPIs', async () => {
        const totalInBuyToken = userAmountInBuyToken.div(2)
        claimRefundData = [
          {
            data: ethers.utils.defaultAbiCoder.encode([], []),
            identifier: ido.address,
            token: IDOToken.address,
            KPIIndices: [0, 3]
          }
        ]

        await expect(refundClaimer.connect(claimer).claimRefundForAccount(user.address, claimRefundData))
          .to.emit(refundClaimer, 'ClaimRefund')
          .withArgs(claimer.address, IDOToken.address, ido.address, user.address, totalInBuyToken, totalInBuyToken)
        expect(await buyToken.balanceOf(user.address)).to.eq(totalInBuyToken)
      })

      it('few KPIs:claimRefundForAccount:claiming is not available', async () => {
        await refundRequester.setClaimableKPI(buyToken.address, ido.address, 0, false)
        await refundRequester.setClaimableKPI(buyToken.address, ido.address, 3, false)

        claimRefundData = [
          {
            data: ethers.utils.defaultAbiCoder.encode([], []),
            identifier: ido.address,
            token: IDOToken.address,
            KPIIndices: [0, 3]
          }
        ]

        await expect(refundClaimer.connect(claimer).claimRefundForAccount(user.address, claimRefundData)).to.not.emit(
          refundClaimer,
          'ClaimRefund'
        )
        expect(await buyToken.balanceOf(user.address)).to.eq(0)

        claimRefundData = [
          {
            data: ethers.utils.defaultAbiCoder.encode([], []),
            identifier: ido.address,
            token: IDOToken.address,
            KPIIndices: [0]
          }
        ]

        await expect(refundClaimer.connect(claimer).claimRefundForAccount(user.address, claimRefundData)).to.not.emit(
          refundClaimer,
          'ClaimRefund'
        )
        expect(await buyToken.balanceOf(user.address)).to.eq(0)

        claimRefundData = [
          {
            data: ethers.utils.defaultAbiCoder.encode([], []),
            identifier: ido.address,
            token: IDOToken.address,
            KPIIndices: [3]
          }
        ]

        await expect(refundClaimer.connect(claimer).claimRefundForAccount(user.address, claimRefundData)).to.not.emit(
          refundClaimer,
          'ClaimRefund'
        )
        expect(await buyToken.balanceOf(user.address)).to.eq(0)
      })
    })

    describe('claim refund with deflationary ido token', () => {
      let buyDeflationaryToken: TestDeflationaryERC20
      let IDODeflationaryToken: TestDeflationaryERC20
      const deflationaryInBP = 500

      beforeEach(async () => {
        buyDeflationaryToken = await new TestDeflationaryERC20__factory(owner).deploy(
          'BUSD Deflationary',
          'BUSD_DEF',
          expandTo18Decimals(1_000_000),
          deflationaryInBP
        )
        IDODeflationaryToken = await new TestDeflationaryERC20__factory(owner).deploy(
          'IDO Token',
          'IDO_TKN',
          expandTo18Decimals(1_000_000),
          deflationaryInBP
        )

        refundRequester = await new TestRefundRequester__factory(owner).deploy(KPIs, IDODeflationaryToken.address)

        const referralPool = await new TestReferralPool__factory(owner).deploy()
        ido = await new TestRefundIDO__factory(owner).deploy()
        const priceTokenPerBuyTokenInUQ = toUQ112(userAmountInIDOToken).div(userAmountInBuyToken)
        await ido.setBaseInfo(referralPool.address, priceTokenPerBuyTokenInUQ, buyDeflationaryToken.address)
        await ido.addAccount(
          user.address,
          userAmountInIDOToken,
          ethers.constants.AddressZero,
          ethers.constants.AddressZero
        )

        // Deploy claimer
        refundClaimer = await new OneChainRefundClaimer__factory(owner).deploy()

        proxy = await new ERC1967Proxy__factory(owner).deploy(
          refundClaimer.address,
          refundClaimer.interface.encodeFunctionData('initialize', [
            registry.address,
            buyDeflationaryToken.address,
            ido.address,
            ethers.utils.defaultAbiCoder.encode(
              ['address', 'address'],
              [refundRequester.address, IDODeflationaryToken.address]
            )
          ])
        )
        refundClaimer = refundClaimer.attach(proxy.address)

        claimRefundData = [
          {
            data: ethers.utils.defaultAbiCoder.encode([], []),
            identifier: ido.address,
            token: buyDeflationaryToken.address,
            KPIIndices: [0]
          }
        ]

        await buyDeflationaryToken.transfer(refundClaimer.address, contractAmountInIDOToken)
        await refundRequester
          .connect(user)
          .testRequestRefund(
            userAmountInIDOToken,
            userAmountInIDOToken.sub(userAmountInIDOToken.mul(deflationaryInBP).div(BP)),
            ido.address,
            false
          )

        const ROLE_REFUND_CLAIMER = await refundClaimer.ROLE_REFUND_CLAIMER()
        await registry.grantRole(ROLE_REFUND_CLAIMER, claimer.address)
      })

      it('claimRefund:success', async () => {
        const deflationaryAmountInIDOToken = userAmountInIDOToken.sub(
          userAmountInIDOToken.mul(deflationaryInBP).div(BP)
        )
        const userAmountInBuyToken = deflationaryAmountInIDOToken.div(2)
        const deflationaryAmountInBuyToken = userAmountInBuyToken.sub(
          userAmountInBuyToken.mul(deflationaryInBP).div(BP)
        )
        await expect(refundClaimer.connect(user).claimRefund(claimRefundData))
          .to.emit(refundClaimer, 'ClaimRefund')
          .withArgs(
            user.address,
            buyDeflationaryToken.address,
            ido.address,
            user.address,
            userAmountInBuyToken,
            deflationaryAmountInBuyToken
          )
        expect(
          await refundClaimer.refundClaimedByKPIInIDOToken(buyDeflationaryToken.address, ido.address, user.address, [0])
        ).to.eq(deflationaryAmountInIDOToken)

        expect(await buyDeflationaryToken.balanceOf(user.address)).to.eq(deflationaryAmountInBuyToken)
      })
    })
  })
})
