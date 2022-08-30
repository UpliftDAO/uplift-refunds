import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address'
import { expect } from 'chai'
import { ethers } from 'hardhat'
import {
  ERC1967Proxy,
  ERC1967Proxy__factory,
  OneChainDatesRefundVesting,
  OneChainDatesRefundVesting__factory,
  Registry,
  Registry__factory,
  TestERC20,
  TestERC20__factory,
  TestReferralPool__factory,
  TestRefundIDO,
  TestRefundIDO__factory,
  TestRefundRequester,
  TestRefundRequester__factory,
  UpgradedOneChainDatesRefundVesting,
  UpgradedOneChainDatesRefundVesting__factory
} from '../typechain'
import { days, hours } from '../utils/time'
import { expandTo18Decimals, latestBlockTimestamp, mineBlockAtTime, toUQ112 } from '../utils/utilities'
import { TestDeflationaryERC20__factory } from './../typechain/factories/TestDeflationaryERC20__factory'

describe('OneChainDatesRefundVesting', () => {
  let owner: SignerWithAddress
  let user: SignerWithAddress

  let registry: Registry
  let IDOToken: TestERC20
  let IDOToken2: TestERC20

  let ido: TestRefundIDO
  let refund: TestRefundRequester
  let vesting: OneChainDatesRefundVesting
  let proxy: ERC1967Proxy

  let bpPrecision: number
  let tgePercentage: number
  let tgeDate: number
  let vestingPercentage: number
  let vestingDates: number[]
  let KPIs: KPI[]

  const BP = 10_000
  const userAmountInIDOToken = expandTo18Decimals(100)
  const userAmountInBuyToken = expandTo18Decimals(50)

  type KPI = {
    dateRequestStart: number
    dateRequestEnd: number
    percentInBP: number
    multiplierInBP: number
    isFullRefund: boolean
    isRefundable: boolean
    isClaimable: boolean
  }

  type InitializeInfo = {
    token: string
    identifier: string
    refund: string
  }

  beforeEach(async () => {
    ;[owner, user] = await ethers.getSigners()

    registry = await new Registry__factory(owner).deploy(owner.address)
    IDOToken = await new TestERC20__factory(owner).deploy('IDO Token', 'IDO_TKN', expandTo18Decimals(1_000_000))
    IDOToken2 = await new TestERC20__factory(owner).deploy('IDO Token', 'IDO_TKN', expandTo18Decimals(1_000_000))

    const now = await latestBlockTimestamp(ethers.provider)
    bpPrecision = BP
    tgePercentage = 2_500 // 25%
    tgeDate = now + hours(3)
    vestingDates = [now + days(30), now + days(61), now + days(90)]
    vestingPercentage = 2_500 // 25%

    // Mock IDO
    const referralPool = await new TestReferralPool__factory(owner).deploy()
    ido = await new TestRefundIDO__factory(owner).deploy()
    const priceTokenPerBuyTokenInUQ = toUQ112(userAmountInBuyToken).div(userAmountInIDOToken)
    await ido.setBaseInfo(referralPool.address, priceTokenPerBuyTokenInUQ, IDOToken.address)
    await ido.addAccount(user.address, userAmountInIDOToken, ethers.constants.AddressZero, ethers.constants.AddressZero)

    // Mock Refund
    KPIs = [
      {
        dateRequestStart: tgeDate,
        dateRequestEnd: tgeDate + days(1),
        percentInBP: vestingPercentage,
        multiplierInBP: BP,
        isFullRefund: true,
        isRefundable: true,
        isClaimable: true
      },
      {
        dateRequestStart: vestingDates[0],
        dateRequestEnd: vestingDates[0] + days(1),
        percentInBP: vestingPercentage,
        multiplierInBP: BP,
        isFullRefund: false,
        isRefundable: true,
        isClaimable: true
      },
      {
        dateRequestStart: vestingDates[1],
        dateRequestEnd: vestingDates[1] + days(1),
        percentInBP: vestingPercentage,
        multiplierInBP: BP,
        isFullRefund: false,
        isRefundable: true,
        isClaimable: true
      },
      {
        dateRequestStart: vestingDates[2],
        dateRequestEnd: vestingDates[2] + days(1),
        percentInBP: vestingPercentage,
        multiplierInBP: BP,
        isFullRefund: false,
        isRefundable: true,
        isClaimable: true
      }
    ]
    refund = await new TestRefundRequester__factory(owner).deploy(KPIs, IDOToken.address)

    // Deploy vesting
    vesting = await new OneChainDatesRefundVesting__factory(owner).deploy()
    const initializeInfo: InitializeInfo = {
      token: IDOToken.address,
      identifier: ido.address,
      refund: refund.address
    }

    proxy = await new ERC1967Proxy__factory(owner).deploy(
      vesting.address,
      vesting.interface.encodeFunctionData('initialize', [
        registry.address,
        initializeInfo,
        ethers.utils.defaultAbiCoder.encode(
          ['uint64', 'uint64', 'uint32', 'uint32[]'],
          [bpPrecision, tgePercentage, tgeDate, vestingDates]
        )
      ])
    )
    vesting = vesting.attach(proxy.address)
  })

  describe('upgradeability', () => {
    let updatedVesting: UpgradedOneChainDatesRefundVesting

    beforeEach(async () => {
      updatedVesting = await new UpgradedOneChainDatesRefundVesting__factory(owner).deploy()
    })

    it('upgrade:successfully', async () => {
      expect(await vesting.attach(proxy.address).refundOf(IDOToken.address, ido.address)).to.eq(refund.address)
      await vesting.upgradeTo(updatedVesting.address)
      expect(await updatedVesting.attach(proxy.address).refundOf(IDOToken.address, ido.address)).to.eq(refund.address)
      expect(await updatedVesting.attach(proxy.address).test()).to.eq('Success')
    })

    it('upgrade:forbidden', async () => {
      await expect(vesting.connect(user).upgradeTo(updatedVesting.address)).to.revertedWith('BRC:F')
    })
  })

  describe('initialization', () => {
    it('initialization', async () => {
      const info = await vesting.infoOf(IDOToken.address, ido.address, user.address)
      // Check vesting info
      expect(info.vestingInfo.tgePercentage).to.eq(tgePercentage)
      expect(info.vestingInfo.tgeDate).to.eq(tgeDate)
      expect(info.vestingInfo.vestingPercentage).to.eq(vestingPercentage)
      expect(info.vestingInfo.vestingDates).to.eql(vestingDates)

      // Check account info
      expect(info.refundInfo.total).to.eq(userAmountInIDOToken)
      expect(info.refundInfo.totalClaimed).to.eq(0)
      expect(info.refundInfo.withdrawableAmount).to.eq(0)

      // Check common info
      expect(info.refundInfo.refund).to.eq(refund.address)
    })

    it('initialization:dates vesting library failed initialization:BP precision is less than TGE percentage', async () => {
      // Deploy vesting
      vesting = await new OneChainDatesRefundVesting__factory(owner).deploy()
      const initializeInfo: InitializeInfo = {
        token: IDOToken.address,
        identifier: ido.address,
        refund: refund.address
      }

      bpPrecision = tgePercentage - 1
      await expect(
        new ERC1967Proxy__factory(owner).deploy(
          vesting.address,
          vesting.interface.encodeFunctionData('initialize', [
            registry.address,
            initializeInfo,
            ethers.utils.defaultAbiCoder.encode(
              ['uint64', 'uint64', 'uint32', 'uint32[]'],
              [bpPrecision, tgePercentage, tgeDate, vestingDates]
            )
          ])
        )
      ).to.revertedWith('DVL:I')
    })
  })

  describe('vesting with refunds', () => {
    it('refund non-claimed tge:claim other', async () => {
      await mineBlockAtTime(ethers.provider, tgeDate)

      // User request refund for TGE (25 tokens)
      const available = await vesting.withdrawableOf(IDOToken.address, ido.address, user.address)
      await refund.connect(user).testRequestRefund(available, available, ido.address, false)
      let info = await vesting.infoOf(IDOToken.address, ido.address, user.address)
      expect(info.refundInfo.totalClaimed).to.eq(0)

      // Next claims
      const expectedClaimedTotal = userAmountInIDOToken.sub(available)
      await IDOToken.transfer(vesting.address, expectedClaimedTotal)

      for (let i = 0; i < vestingDates.length; ++i) {
        await mineBlockAtTime(ethers.provider, vestingDates[i])
        // TODO: Remove with vesting update
        await refund.setCurrentKPIIndex(i + 1)

        const available1 = await vesting.withdrawableOf(IDOToken.address, ido.address, user.address)
        const expectedAvailable1 = userAmountInIDOToken.mul(vestingPercentage).div(bpPrecision)
        expect(available1).to.be.eq(expectedAvailable1)

        await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address))
          .to.emit(vesting, 'Withdraw')
          .withArgs(IDOToken.address, ido.address, user.address, available1, available1)

        info = await vesting.infoOf(IDOToken.address, ido.address, user.address)
        expect(info.refundInfo.totalClaimed).to.eq(expectedAvailable1.mul(i + 1))

        await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address)).to.be.revertedWith('BRV:Z')
      }

      expect(await IDOToken.balanceOf(vesting.address)).to.eq(0)
      expect(await IDOToken.balanceOf(user.address)).to.eq(expectedClaimedTotal)
    })

    it('refund full claimed tge:claim other', async () => {
      await mineBlockAtTime(ethers.provider, tgeDate)
      await IDOToken.transfer(vesting.address, userAmountInIDOToken)

      // User claim TGE tokens
      const available = await vesting.withdrawableOf(IDOToken.address, ido.address, user.address)
      await vesting.connect(user).withdraw(IDOToken.address, ido.address)
      let info = await vesting.infoOf(IDOToken.address, ido.address, user.address)
      expect(info.refundInfo.totalClaimed).to.eq(available)

      // User refund full TGE tokens
      await IDOToken.connect(user).approve(refund.address, available)
      await refund.connect(user).testRequestRefund(available, available, ido.address, true)

      info = await vesting.infoOf(IDOToken.address, ido.address, user.address)
      expect(info.refundInfo.totalClaimed).to.eq(available)
      const availableAfterRefund = await vesting.withdrawableOf(IDOToken.address, ido.address, user.address)
      expect(availableAfterRefund).to.eq(0)

      for (let i = 0; i < vestingDates.length; ++i) {
        await mineBlockAtTime(ethers.provider, vestingDates[i])
        // TODO: Remove with vesting update
        await refund.setCurrentKPIIndex(i + 1)

        const available1 = await vesting.withdrawableOf(IDOToken.address, ido.address, user.address)
        const expectedAvailable1 = userAmountInIDOToken.mul(vestingPercentage).div(bpPrecision)
        expect(available1).to.be.eq(expectedAvailable1)

        await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address))
          .to.emit(vesting, 'Withdraw')
          .withArgs(IDOToken.address, ido.address, user.address, available1, available1)

        info = await vesting.infoOf(IDOToken.address, ido.address, user.address)
        expect(info.refundInfo.totalClaimed).to.eq(available.add(expectedAvailable1.mul(i + 1)))

        await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address)).to.be.revertedWith('BRV:Z')
      }

      expect(await IDOToken.balanceOf(vesting.address)).to.eq(0)
      expect(await IDOToken.balanceOf(user.address)).to.eq(userAmountInIDOToken.sub(available))
    })

    it('refund part claimed tge:claim other', async () => {
      await mineBlockAtTime(ethers.provider, tgeDate)
      await IDOToken.transfer(vesting.address, userAmountInIDOToken)

      // User claim TGE tokens
      const available = await vesting.withdrawableOf(IDOToken.address, ido.address, user.address)
      await vesting.connect(user).withdraw(IDOToken.address, ido.address)
      let info = await vesting.infoOf(IDOToken.address, ido.address, user.address)
      expect(info.refundInfo.totalClaimed).to.eq(available)

      // User refund 50% of TGE tokens
      await IDOToken.approve(refund.address, available)
      const refundAmount = available.div(2)
      await IDOToken.connect(user).approve(refund.address, refundAmount)
      await refund.connect(user).testRequestRefund(refundAmount, refundAmount, ido.address, true)

      info = await vesting.infoOf(IDOToken.address, ido.address, user.address)
      expect(info.refundInfo.totalClaimed).to.eq(available)
      const availableAfterRefund = await vesting.withdrawableOf(IDOToken.address, ido.address, user.address)
      expect(availableAfterRefund).to.eq(0)

      for (let i = 0; i < vestingDates.length; ++i) {
        await mineBlockAtTime(ethers.provider, vestingDates[i])
        // TODO: Remove with vesting update
        await refund.setCurrentKPIIndex(i + 1)

        const available1 = await vesting.withdrawableOf(IDOToken.address, ido.address, user.address)
        const expectedAvailable1 = userAmountInIDOToken.mul(vestingPercentage).div(bpPrecision)
        expect(available1).to.be.eq(expectedAvailable1)

        await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address))
          .to.emit(vesting, 'Withdraw')
          .withArgs(IDOToken.address, ido.address, user.address, available1, available1)

        info = await vesting.infoOf(IDOToken.address, ido.address, user.address)
        expect(info.refundInfo.totalClaimed).to.eq(available.add(expectedAvailable1.mul(i + 1)))

        await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address)).to.be.revertedWith('BRV:Z')
      }

      expect(await IDOToken.balanceOf(vesting.address)).to.eq(0)
      expect(await IDOToken.balanceOf(user.address)).to.eq(userAmountInIDOToken.sub(refundAmount))
    })

    it('refund 2 and 4 KPI without claiming', async () => {
      await mineBlockAtTime(ethers.provider, tgeDate)
      await IDOToken.transfer(vesting.address, userAmountInIDOToken)

      // User claim TGE
      const available1 = await vesting.withdrawableOf(IDOToken.address, ido.address, user.address)
      await vesting.connect(user).withdraw(IDOToken.address, ido.address)

      // User asks refund for 2 KPI
      await mineBlockAtTime(ethers.provider, vestingDates[0])
      await refund.setCurrentKPIIndex(1)
      const available2 = await vesting.withdrawableOf(IDOToken.address, ido.address, user.address)
      const expectedAvailable2 = userAmountInIDOToken.mul(KPIs[1].percentInBP).div(bpPrecision)
      expect(available2).to.eq(expectedAvailable2)

      await refund.connect(user).testRequestRefund(available2, available2, ido.address, false)
      let info = await vesting.infoOf(IDOToken.address, ido.address, user.address)
      expect(info.refundInfo.totalClaimed).to.eq(available1)

      // User claims 3 vesting period
      await mineBlockAtTime(ethers.provider, vestingDates[1])
      await refund.setCurrentKPIIndex(2)
      const available3 = await vesting.withdrawableOf(IDOToken.address, ido.address, user.address)
      const expectedAvailable3 = userAmountInIDOToken.mul(KPIs[2].percentInBP).div(bpPrecision)

      expect(available3).to.eq(expectedAvailable3)
      await vesting.connect(user).withdraw(IDOToken.address, ido.address)

      // User asks refund for 4 KPI
      await mineBlockAtTime(ethers.provider, vestingDates[2])
      await refund.setCurrentKPIIndex(3)
      const available4 = await vesting.withdrawableOf(IDOToken.address, ido.address, user.address)
      const expectedAvailable4 = userAmountInIDOToken.mul(KPIs[1].percentInBP).div(bpPrecision)
      expect(available4).to.eq(expectedAvailable4)

      await refund.connect(user).testRequestRefund(available4, available4, ido.address, false)
      info = await vesting.infoOf(IDOToken.address, ido.address, user.address)
      expect(info.refundInfo.totalClaimed).to.eq(available1.add(available3))

      // Final checks
      const userTokens = available1.add(available3)
      expect(await IDOToken.balanceOf(vesting.address)).to.eq(userAmountInIDOToken.sub(userTokens))
      expect(await IDOToken.balanceOf(user.address)).to.eq(userTokens)
    })

    it('refund 2 KPI after claim:4 KPI without claiming', async () => {
      await mineBlockAtTime(ethers.provider, tgeDate)
      await IDOToken.transfer(vesting.address, userAmountInIDOToken)

      // User claim TGE
      const available1 = await vesting.withdrawableOf(IDOToken.address, ido.address, user.address)
      await vesting.connect(user).withdraw(IDOToken.address, ido.address)

      // User asks refund for 2 KPI
      await mineBlockAtTime(ethers.provider, vestingDates[0])
      await refund.setCurrentKPIIndex(1)
      const available2 = await vesting.withdrawableOf(IDOToken.address, ido.address, user.address)
      const expectedAvailable2 = userAmountInIDOToken.mul(KPIs[1].percentInBP).div(bpPrecision)
      expect(available2).to.eq(expectedAvailable2)

      await vesting.connect(user).withdraw(IDOToken.address, ido.address)
      await IDOToken.connect(user).approve(refund.address, available2)
      await refund.connect(user).testRequestRefund(available2, available2, ido.address, true)
      let info = await vesting.infoOf(IDOToken.address, ido.address, user.address)
      expect(info.refundInfo.totalClaimed).to.eq(available1.add(available2))

      // User claims 3 vesting period
      await mineBlockAtTime(ethers.provider, vestingDates[1])
      await refund.setCurrentKPIIndex(2)
      const available3 = await vesting.withdrawableOf(IDOToken.address, ido.address, user.address)
      const expectedAvailable3 = userAmountInIDOToken.mul(KPIs[2].percentInBP).div(bpPrecision)

      expect(available3).to.eq(expectedAvailable3)
      await vesting.connect(user).withdraw(IDOToken.address, ido.address)

      // User asks refund for 4 KPI
      await mineBlockAtTime(ethers.provider, vestingDates[2])
      await refund.setCurrentKPIIndex(3)
      const available4 = await vesting.withdrawableOf(IDOToken.address, ido.address, user.address)
      const expectedAvailable4 = userAmountInIDOToken.mul(KPIs[1].percentInBP).div(bpPrecision)
      expect(available4).to.eq(expectedAvailable4)

      await refund.connect(user).testRequestRefund(available4, available4, ido.address, false)
      info = await vesting.infoOf(IDOToken.address, ido.address, user.address)
      expect(info.refundInfo.totalClaimed).to.eq(available1.add(available2).add(available3))

      // Final checks
      expect(await IDOToken.balanceOf(vesting.address)).to.eq(
        userAmountInIDOToken.sub(available1.add(available2).add(available3))
      )
      expect(await IDOToken.balanceOf(user.address)).to.eq(available1.add(available3))
    })

    it('not claimed TGE, 2 KPI refund', async () => {
      // User asks refund for 2 KPI
      await mineBlockAtTime(ethers.provider, vestingDates[0])
      await refund.setCurrentKPIIndex(1)
      await IDOToken.transfer(vesting.address, userAmountInIDOToken)

      // User ask for refund for second KPI
      const available = await vesting.withdrawableOf(IDOToken.address, ido.address, user.address)
      const expectedAvailable = userAmountInIDOToken.mul(KPIs[0].percentInBP + KPIs[1].percentInBP).div(bpPrecision)
      expect(available).to.eq(expectedAvailable)

      const askFor2Refund = userAmountInIDOToken.mul(KPIs[1].percentInBP).div(bpPrecision)
      await refund.connect(user).testRequestRefund(askFor2Refund, askFor2Refund, ido.address, false)

      // User claims 1 and 3 KPI
      await mineBlockAtTime(ethers.provider, vestingDates[1])
      await refund.setCurrentKPIIndex(2)

      const available2 = await vesting.withdrawableOf(IDOToken.address, ido.address, user.address)
      const expectedAvailable2 = userAmountInIDOToken.mul(KPIs[0].percentInBP + KPIs[2].percentInBP).div(bpPrecision)
      expect(available2).to.eq(expectedAvailable2)
      await vesting.connect(user).withdraw(IDOToken.address, ido.address)
      const info = await vesting.infoOf(IDOToken.address, ido.address, user.address)
      expect(info.refundInfo.totalClaimed).to.eq(available2)
    })

    it('claim after refund', async () => {
      await mineBlockAtTime(ethers.provider, tgeDate)
      const available = await vesting.withdrawableOf(IDOToken.address, ido.address, user.address)
      await refund.connect(user).testRequestRefund(available, available, ido.address, false)

      // User can't claim TGE tokens (already refunded)
      await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address)).to.be.revertedWith('BRV:Z')
    })

    it('withdraw:deflationary token', async () => {
      const deflationaryInBP = 500
      const IDOTokenDeflationary = await new TestDeflationaryERC20__factory(owner).deploy(
        'IDO Token',
        'IDO_TKN',
        expandTo18Decimals(1_000_000),
        deflationaryInBP
      )

      refund = await new TestRefundRequester__factory(owner).deploy(KPIs, IDOTokenDeflationary.address)

      // Deploy vesting
      vesting = await new OneChainDatesRefundVesting__factory(owner).deploy()
      const initializeInfo: InitializeInfo = {
        token: IDOTokenDeflationary.address,
        identifier: ido.address,
        refund: refund.address
      }

      proxy = await new ERC1967Proxy__factory(owner).deploy(
        vesting.address,
        vesting.interface.encodeFunctionData('initialize', [
          registry.address,
          initializeInfo,
          ethers.utils.defaultAbiCoder.encode(
            ['uint64', 'uint64', 'uint32', 'uint32[]'],
            [bpPrecision, tgePercentage, tgeDate, vestingDates]
          )
        ])
      )
      vesting = vesting.attach(proxy.address)

      await mineBlockAtTime(ethers.provider, tgeDate)
      await IDOTokenDeflationary.transfer(vesting.address, userAmountInIDOToken)

      // User claim TGE tokens
      const available = await vesting.withdrawableOf(IDOTokenDeflationary.address, ido.address, user.address)
      const amountInTokenAfterTransfer = available.sub(available.mul(deflationaryInBP).div(BP))
      await expect(vesting.connect(user).withdraw(IDOTokenDeflationary.address, ido.address))
        .to.emit(vesting, 'Withdraw')
        .withArgs(IDOTokenDeflationary.address, ido.address, user.address, available, amountInTokenAfterTransfer)
      expect(await IDOTokenDeflationary.balanceOf(user.address)).to.eq(amountInTokenAfterTransfer)
      const info = await vesting.infoOf(IDOTokenDeflationary.address, ido.address, user.address)
      expect(info.refundInfo.total).to.eq(userAmountInIDOToken)
      expect(info.refundInfo.totalClaimed).to.eq(available)
      expect(info.refundInfo.withdrawableAmount).to.eq(0)

      // Check available
      expect(await vesting.withdrawableOf(IDOTokenDeflationary.address, ido.address, user.address)).to.eq(0)
    })
  })

  describe('vesting without refunds', () => {
    describe('tge', () => {
      beforeEach(async () => {
        const now = await latestBlockTimestamp(ethers.provider)

        bpPrecision = 100_000
        tgePercentage = 100_000 // 100%
        tgeDate = now + hours(3)
        vestingDates = []
        vestingPercentage = 0

        vesting = await new OneChainDatesRefundVesting__factory(owner).deploy()
        const initializeInfo: InitializeInfo = {
          token: IDOToken2.address,
          identifier: ido.address,
          refund: ethers.constants.AddressZero
        }
        proxy = await new ERC1967Proxy__factory(owner).deploy(
          vesting.address,
          vesting.interface.encodeFunctionData('initialize', [
            registry.address,
            initializeInfo,
            ethers.utils.defaultAbiCoder.encode(
              ['uint64', 'uint64', 'uint32', 'uint32[]'],
              [bpPrecision, tgePercentage, tgeDate, vestingDates]
            )
          ])
        )

        vesting = vesting.attach(proxy.address)
      })

      it('tge', async () => {
        await IDOToken2.transfer(vesting.address, userAmountInIDOToken)
        await expect(vesting.connect(user.address).withdraw(IDOToken2.address, ido.address)).to.be.revertedWith('BRV:Z')

        await mineBlockAtTime(ethers.provider, tgeDate)
        const lastBalance = await IDOToken2.balanceOf(user.address)
        await expect(vesting.connect(user).withdraw(IDOToken2.address, ido.address))
          .to.emit(vesting, 'Withdraw')
          .withArgs(IDOToken2.address, ido.address, user.address, userAmountInIDOToken, userAmountInIDOToken)

        expect(await IDOToken2.balanceOf(user.address)).to.eq(lastBalance.add(userAmountInIDOToken))

        const info = await vesting.infoOf(IDOToken2.address, ido.address, user.address)
        expect(info.refundInfo.total).to.eq(userAmountInIDOToken)
        expect(info.refundInfo.totalClaimed).to.eq(userAmountInIDOToken)
        expect(info.refundInfo.withdrawableAmount).to.eq(0)

        await expect(vesting.connect(user.address).withdraw(IDOToken2.address, ido.address)).to.be.revertedWith('BRV:Z')
      })
    })

    describe('tge + vestingIntervals', () => {
      beforeEach(async () => {
        const now = await latestBlockTimestamp(ethers.provider)

        bpPrecision = 100_000
        tgePercentage = 10_000 // 10%
        tgeDate = now + hours(3)

        vestingDates = [
          now + days(30),
          now + days(61),
          now + days(90),
          now + days(121),
          now + days(150),
          now + days(181),
          now + days(210),
          now + days(241),
          now + days(270),
          now + days(301),
          now + days(330),
          now + days(361)
        ]
        vestingPercentage = 7_500

        vesting = await new OneChainDatesRefundVesting__factory(owner).deploy()
        const initializeInfo: InitializeInfo = {
          token: IDOToken.address,
          identifier: ido.address,
          refund: ethers.constants.AddressZero
        }
        proxy = await new ERC1967Proxy__factory(owner).deploy(
          vesting.address,
          vesting.interface.encodeFunctionData('initialize', [
            registry.address,
            initializeInfo,
            ethers.utils.defaultAbiCoder.encode(
              ['uint64', 'uint64', 'uint32', 'uint32[]'],
              [bpPrecision, tgePercentage, tgeDate, vestingDates]
            )
          ])
        )

        vesting = vesting.attach(proxy.address)
      })

      describe('addTokenInfo', () => {
        it('addTokenInfo:forbidden', async () => {
          const initializeInfo: InitializeInfo = {
            token: IDOToken.address,
            identifier: ido.address,
            refund: ethers.constants.AddressZero
          }
          await expect(
            vesting
              .connect(user.address)
              .addTokenInfo(
                initializeInfo,
                ethers.utils.defaultAbiCoder.encode(
                  ['uint64', 'uint64', 'uint32', 'uint32[]'],
                  [bpPrecision, tgePercentage, tgeDate, vestingDates]
                )
              )
          ).to.be.revertedWith('BRC:F')
        })

        it('addTokenInfo:success', async () => {
          const newToken = await new TestERC20__factory(owner).deploy(
            'NEW_TKN',
            'NEW_TKN',
            expandTo18Decimals(1_000_000)
          )
          const initializeInfo: InitializeInfo = {
            token: newToken.address,
            identifier: ido.address,
            refund: ethers.constants.AddressZero
          }
          await vesting.addTokenInfo(
            initializeInfo,
            ethers.utils.defaultAbiCoder.encode(
              ['uint64', 'uint64', 'uint32', 'uint32[]'],
              [bpPrecision, tgePercentage, tgeDate, vestingDates]
            )
          )

          const info = await vesting.infoOf(newToken.address, ido.address, owner.address)
          const vestingData = info.vestingInfo
          expect(vestingData.bpPrecision).to.be.eq(bpPrecision)
          expect(vestingData.tgeDate).to.be.eq(tgeDate)
          expect(vestingData.tgePercentage).to.be.eq(tgePercentage)
          expect(vestingData.vestingPercentage).to.be.eq(vestingPercentage)
          expect(vestingData.vestingDates).to.be.eql(vestingDates)
        })

        it('change token info:success', async () => {
          let info = await vesting.infoOf(IDOToken.address, ido.address, owner.address)
          let vestingData = info.vestingInfo
          expect(vestingData.tgeDate).to.be.eq(tgeDate)

          const newTGEDate = tgeDate + 10

          const initializeInfo: InitializeInfo = {
            token: IDOToken.address,
            identifier: ido.address,
            refund: ethers.constants.AddressZero
          }
          await vesting.addTokenInfo(
            initializeInfo,
            ethers.utils.defaultAbiCoder.encode(
              ['uint64', 'uint64', 'uint32', 'uint32[]'],
              [bpPrecision, tgePercentage, newTGEDate, vestingDates]
            )
          )

          info = await vesting.infoOf(IDOToken.address, ido.address, owner.address)
          vestingData = info.vestingInfo
          expect(vestingData.tgeDate).to.be.eq(newTGEDate)
          expect(vestingData.tgePercentage).to.be.eq(tgePercentage)
          expect(vestingData.vestingPercentage).to.be.eq(vestingPercentage)
          expect(vestingData.vestingDates).to.be.eql(vestingDates)
        })
      })

      describe('withdraw', () => {
        it('invalid token', async () => {
          const newToken = await new TestERC20__factory(owner).deploy(
            'NEW_TKN',
            'NEW_TKN',
            expandTo18Decimals(1_000_000)
          )

          // Because we didn't transfer newToken
          await expect(vesting.connect(user).withdraw(newToken.address, ido.address)).to.be.revertedWith(
            'ERC20: transfer amount exceeds balance'
          )

          const ido2 = await new TestRefundIDO__factory(owner).deploy()
          const initializeInfo: InitializeInfo = {
            token: newToken.address,
            identifier: ido2.address,
            refund: ethers.constants.AddressZero
          }
          await vesting.addTokenInfo(
            initializeInfo,
            ethers.utils.defaultAbiCoder.encode(
              ['uint64', 'uint64', 'uint32', 'uint32[]'],
              [bpPrecision, tgePercentage, tgeDate, vestingDates]
            )
          )

          await IDOToken.transfer(vesting.address, userAmountInIDOToken)
          await newToken.transfer(vesting.address, userAmountInIDOToken)

          await mineBlockAtTime(ethers.provider, vestingDates[vestingDates.length - 1]) // last date

          await expect(vesting.connect(user).withdraw(newToken.address, ido2.address)).to.be.revertedWith('BRV:Z')
        })

        it('cliff, vesting: withdraws cliff: vesting half: vesting all', async () => {
          const expectedTge = userAmountInIDOToken.mul(tgePercentage).div(bpPrecision)

          await IDOToken.transfer(vesting.address, userAmountInIDOToken)

          expect(await vesting.withdrawableOf(IDOToken.address, ido.address, user.address)).to.eq(0)
          await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address)).to.be.revertedWith('BRV:Z')

          await mineBlockAtTime(ethers.provider, tgeDate)
          const lastUserBalance = await IDOToken.balanceOf(user.address)
          const lastContractBalance = await IDOToken.balanceOf(vesting.address)

          let info = await vesting.infoOf(IDOToken.address, ido.address, user.address)
          expect(info.refundInfo.total).to.eq(userAmountInIDOToken)
          expect(info.refundInfo.totalClaimed).to.eq(0)
          expect(info.refundInfo.withdrawableAmount).to.eq(expectedTge)

          await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address))
            .to.emit(vesting, 'Withdraw')
            .withArgs(IDOToken.address, ido.address, user.address, expectedTge, expectedTge)

          let alreadyWithdrawn = expectedTge
          expect(await IDOToken.balanceOf(user.address)).to.eq(lastUserBalance.add(expectedTge))
          expect(await IDOToken.balanceOf(vesting.address)).to.eq(lastContractBalance.sub(expectedTge))

          info = await vesting.infoOf(IDOToken.address, ido.address, user.address)
          expect(info.refundInfo.total).to.eq(userAmountInIDOToken)
          expect(info.refundInfo.totalClaimed).to.eq(alreadyWithdrawn)
          expect(info.refundInfo.withdrawableAmount).to.eq(0)

          await mineBlockAtTime(ethers.provider, tgeDate + days(1))
          expect(await vesting.withdrawableOf(IDOToken.address, ido.address, user.address)).to.eq(0)
          await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address)).to.be.revertedWith('BRV:Z')

          await mineBlockAtTime(ethers.provider, vestingDates[0])
          await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address))
            .to.emit(vesting, 'Withdraw')
            .withArgs(
              IDOToken.address,
              ido.address,
              user.address,
              userAmountInIDOToken.mul(vestingPercentage).div(bpPrecision),
              userAmountInIDOToken.mul(vestingPercentage).div(bpPrecision)
            )
          alreadyWithdrawn = alreadyWithdrawn.add(userAmountInIDOToken.mul(vestingPercentage).div(bpPrecision))
          info = await vesting.infoOf(IDOToken.address, ido.address, user.address)
          expect(info.refundInfo.total).to.eq(userAmountInIDOToken)
          expect(info.refundInfo.totalClaimed).to.eq(alreadyWithdrawn)
          expect(info.refundInfo.withdrawableAmount).to.eq(0)

          await mineBlockAtTime(ethers.provider, vestingDates[6] + days(5)) // +6 months
          const vesting1to6 = userAmountInIDOToken.mul(vestingPercentage * 6).div(bpPrecision)

          expect(await vesting.withdrawableOf(IDOToken.address, ido.address, user.address)).to.eq(vesting1to6)
          await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address))
            .to.emit(vesting, 'Withdraw')
            .withArgs(IDOToken.address, ido.address, user.address, vesting1to6, vesting1to6)

          alreadyWithdrawn = alreadyWithdrawn.add(vesting1to6)
          info = await vesting.infoOf(IDOToken.address, ido.address, user.address)
          expect(info.refundInfo.total).to.eq(userAmountInIDOToken)
          expect(info.refundInfo.totalClaimed).to.eq(alreadyWithdrawn)
          expect(info.refundInfo.withdrawableAmount).to.eq(0)

          await mineBlockAtTime(ethers.provider, vestingDates[11] + days(30)) // total 12 months,check max
          const vesting7to11 = userAmountInIDOToken.mul(vestingPercentage * 5).div(bpPrecision)

          expect(await vesting.withdrawableOf(IDOToken.address, ido.address, user.address)).to.eq(vesting7to11)
          await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address))
            .to.emit(vesting, 'Withdraw')
            .withArgs(IDOToken.address, ido.address, user.address, vesting7to11, vesting7to11)

          info = await vesting.infoOf(IDOToken.address, ido.address, user.address)
          expect(info.refundInfo.total).to.eq(userAmountInIDOToken)
          expect(info.refundInfo.totalClaimed).to.eq(userAmountInIDOToken)
          expect(info.refundInfo.withdrawableAmount).to.eq(0)

          expect(await IDOToken.balanceOf(vesting.address)).to.eq(0)
          await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address)).to.be.revertedWith('BRV:Z')
        })

        it('cliff, vesting: withdraws all', async () => {
          await IDOToken.transfer(vesting.address, userAmountInIDOToken)

          await mineBlockAtTime(ethers.provider, vestingDates[11] + days(3)) // total 12 months

          await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address))
            .to.emit(vesting, 'Withdraw')
            .withArgs(IDOToken.address, ido.address, user.address, userAmountInIDOToken, userAmountInIDOToken)

          expect(await IDOToken.balanceOf(vesting.address)).to.eq(0)
          await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address)).to.be.revertedWith('BRV:Z')
        })

        it('cliff, vesting: clift then withdraw all at the end', async () => {
          await IDOToken.transfer(vesting.address, userAmountInIDOToken)
          const expectedTge = userAmountInIDOToken.mul(tgePercentage).div(bpPrecision)

          await mineBlockAtTime(ethers.provider, tgeDate)
          const lastUserBalance = await IDOToken.balanceOf(user.address)
          const lastContractBalance = await IDOToken.balanceOf(vesting.address)

          await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address))
            .to.emit(vesting, 'Withdraw')
            .withArgs(IDOToken.address, ido.address, user.address, expectedTge, expectedTge)

          expect(await IDOToken.balanceOf(user.address)).to.eq(lastUserBalance.add(expectedTge))
          expect(await IDOToken.balanceOf(vesting.address)).to.eq(lastContractBalance.sub(expectedTge))

          await mineBlockAtTime(ethers.provider, vestingDates[11] + days(3)) // total 12 months

          await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address))
            .to.emit(vesting, 'Withdraw')
            .withArgs(
              IDOToken.address,
              ido.address,
              user.address,
              userAmountInIDOToken.sub(expectedTge),
              userAmountInIDOToken.sub(expectedTge)
            )

          expect(await IDOToken.balanceOf(vesting.address)).to.eq(0)
          await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address)).to.be.revertedWith('BRV:Z')
        })

        it('cliff, vesting: withdraws after cliff', async () => {
          await IDOToken.transfer(vesting.address, userAmountInIDOToken)

          await mineBlockAtTime(ethers.provider, vestingDates[0] + days(3)) // 1 months
          // This is second vesting period
          const vestingTgePlus1 = userAmountInIDOToken.mul(tgePercentage + vestingPercentage).div(bpPrecision)

          await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address))
            .to.emit(vesting, 'Withdraw')
            .withArgs(IDOToken.address, ido.address, user.address, vestingTgePlus1, vestingTgePlus1)

          await mineBlockAtTime(ethers.provider, vestingDates[11] + days(3)) // total 12 months

          // 2 + 10 = 12
          await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address))
            .to.emit(vesting, 'Withdraw')
            .withArgs(
              IDOToken.address,
              ido.address,
              user.address,
              userAmountInIDOToken.sub(vestingTgePlus1),
              userAmountInIDOToken.sub(vestingTgePlus1)
            )

          expect(await IDOToken.balanceOf(vesting.address)).to.eq(0)
          await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address)).to.be.revertedWith('BRV:Z')
        })

        it('cliff:withdraw:get info', async () => {
          const expectedTge = userAmountInIDOToken.mul(tgePercentage).div(bpPrecision)

          await IDOToken.transfer(vesting.address, userAmountInIDOToken)

          await mineBlockAtTime(ethers.provider, tgeDate)
          const lastBalance = await IDOToken.balanceOf(user.address)
          await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address))
            .to.emit(vesting, 'Withdraw')
            .withArgs(IDOToken.address, ido.address, user.address, expectedTge, expectedTge)

          expect(await IDOToken.balanceOf(user.address)).to.eq(lastBalance.add(expectedTge))

          let info = await vesting.infoOf(IDOToken.address, ido.address, user.address)
          expect(info.refundInfo.total).to.eq(userAmountInIDOToken)
          expect(info.refundInfo.totalClaimed).to.eq(expectedTge)
          expect(info.refundInfo.withdrawableAmount).to.eq(0)

          await mineBlockAtTime(ethers.provider, vestingDates[0])
          await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address))
            .to.emit(vesting, 'Withdraw')
            .withArgs(
              IDOToken.address,
              ido.address,
              user.address,
              userAmountInIDOToken.mul(vestingPercentage).div(bpPrecision),
              userAmountInIDOToken.mul(vestingPercentage).div(bpPrecision)
            )

          info = await vesting.infoOf(IDOToken.address, ido.address, user.address)
          expect(info.refundInfo.total).to.eq(userAmountInIDOToken)
          expect(info.refundInfo.totalClaimed).to.eq(
            userAmountInIDOToken.mul(tgePercentage + vestingPercentage).div(bpPrecision)
          )
          expect(info.refundInfo.withdrawableAmount).to.eq(0)

          await mineBlockAtTime(ethers.provider, vestingDates[0] + (vestingDates[1] - vestingDates[0]) / 2)
          expect(await vesting.withdrawableOf(IDOToken.address, ido.address, user.address)).to.eq(0)

          await mineBlockAtTime(ethers.provider, vestingDates[1])

          expect(await vesting.withdrawableOf(IDOToken.address, ido.address, user.address)).to.eq(
            userAmountInIDOToken.mul(vestingPercentage).div(bpPrecision)
          )
          await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address))
            .to.emit(vesting, 'Withdraw')
            .withArgs(
              IDOToken.address,
              ido.address,
              user.address,
              userAmountInIDOToken.mul(vestingPercentage).div(bpPrecision),
              userAmountInIDOToken.mul(vestingPercentage).div(bpPrecision)
            )
          info = await vesting.infoOf(IDOToken.address, ido.address, user.address)
          expect(info.refundInfo.total).to.eq(userAmountInIDOToken)
          expect(info.refundInfo.totalClaimed).to.eq(
            userAmountInIDOToken.mul(tgePercentage + vestingPercentage * 2).div(bpPrecision)
          )
          expect(info.refundInfo.withdrawableAmount).to.eq(0)
        })

        it('cliff:withdraw one by one', async () => {
          const expectedTge = userAmountInIDOToken.mul(tgePercentage).div(bpPrecision)

          await IDOToken.transfer(vesting.address, userAmountInIDOToken)

          await mineBlockAtTime(ethers.provider, tgeDate)
          await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address))
            .to.emit(vesting, 'Withdraw')
            .withArgs(IDOToken.address, ido.address, user.address, expectedTge, expectedTge)

          for (let i = 0; i < vestingDates.length; ++i) {
            await mineBlockAtTime(ethers.provider, vestingDates[i])
            await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address))
              .to.emit(vesting, 'Withdraw')
              .withArgs(
                IDOToken.address,
                ido.address,
                user.address,
                userAmountInIDOToken.mul(vestingPercentage).div(bpPrecision),
                userAmountInIDOToken.mul(vestingPercentage).div(bpPrecision)
              )
          }

          expect(await IDOToken.balanceOf(vesting.address)).to.eq(0)
          await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address)).to.be.revertedWith('BRV:Z')
        })
      })
    })
  })
})
