import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address'
import { expect } from 'chai'
import { BigNumber } from 'ethers'
import { ethers } from 'hardhat'
import {
  ERC1967Proxy,
  ERC1967Proxy__factory,
  OneChainDatesRefundVesting,
  OneChainDatesRefundVesting__factory,
  OneChainRefundRequester,
  OneChainRefundRequester__factory,
  Registry,
  Registry__factory,
  TestERC20,
  TestERC20__factory,
  TestReferralPool,
  TestReferralPool__factory,
  TestRefundIDO,
  TestRefundIDO__factory,
  UpgradedOneChainRefundRequester,
  UpgradedOneChainRefundRequester__factory
} from '../typechain'
import { days, hours } from '../utils/time'
import { expandTo18Decimals, latestBlockTimestamp, mineBlockAtTime, toUQ112 } from '../utils/utilities'

describe('OneChainRefundRequester', () => {
  let owner: SignerWithAddress
  let user: SignerWithAddress
  let user2: SignerWithAddress
  let referrer: SignerWithAddress
  let referrer2: SignerWithAddress
  let defaultReferrer: SignerWithAddress

  let registry: Registry
  let IDOToken: TestERC20

  let referralPool: TestReferralPool
  let ido: TestRefundIDO
  let refund: OneChainRefundRequester
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
  const zeroData = ethers.utils.defaultAbiCoder.encode([], [])

  type KPI = {
    dateRequestStart: number
    dateRequestEnd: number
    percentInBP: number
    multiplierInBP: number
    isFullRefund: boolean
    isRefundable: boolean
  }

  type InitializeVestingInfo = {
    token: string
    identifier: string
    refund: string
  }

  type InitializeRefundInfo = {
    token: string
    identifier: string
    vesting: string
    projectFundsHolder: string
    KPIs: KPI[]
    bpPrecision: number
  }

  beforeEach(async () => {
    ;[owner, user, user2, referrer, referrer2, defaultReferrer] = await ethers.getSigners()

    registry = await new Registry__factory(owner).deploy(owner.address)
    IDOToken = await new TestERC20__factory(owner).deploy('IDO Token', 'IDO_TKN', expandTo18Decimals(1_000_000))

    const now = await latestBlockTimestamp(ethers.provider)
    bpPrecision = BP
    tgePercentage = 2_500 // 25%
    tgeDate = now + hours(3)
    vestingDates = [now + days(30), now + days(61), now + days(90)]
    vestingPercentage = 2_500 // 25%

    // Mock referral pool
    referralPool = await new TestReferralPool__factory(owner).deploy()

    // Mock IDO
    ido = await new TestRefundIDO__factory(owner).deploy()
    const priceTokenPerBuyTokenInUQ = toUQ112(userAmountInBuyToken).div(userAmountInIDOToken)
    await ido.setBaseInfo(referralPool.address, priceTokenPerBuyTokenInUQ)
    await ido.addAccount(user.address, userAmountInIDOToken, referrer.address, defaultReferrer.address)

    // Vesting
    vesting = await new OneChainDatesRefundVesting__factory(owner).deploy()
    const initializeVestingInfo: InitializeVestingInfo = {
      token: IDOToken.address,
      identifier: ido.address,
      refund: ethers.constants.AddressZero
    }

    proxy = await new ERC1967Proxy__factory(owner).deploy(
      vesting.address,
      vesting.interface.encodeFunctionData('initialize', [
        registry.address,
        initializeVestingInfo,
        ethers.utils.defaultAbiCoder.encode(
          ['uint64', 'uint64', 'uint32', 'uint32[]'],
          [bpPrecision, tgePercentage, tgeDate, vestingDates]
        )
      ])
    )
    vesting = vesting.attach(proxy.address)

    // Refund requester
    KPIs = [
      {
        dateRequestStart: tgeDate,
        dateRequestEnd: tgeDate + days(1),
        percentInBP: 0,
        multiplierInBP: BP,
        isFullRefund: true,
        isRefundable: true
      },
      {
        dateRequestStart: vestingDates[0],
        dateRequestEnd: vestingDates[0] + days(1),
        percentInBP: vestingPercentage * 2,
        multiplierInBP: BP,
        isFullRefund: false,
        isRefundable: true
      },
      {
        dateRequestStart: vestingDates[1],
        dateRequestEnd: vestingDates[1] + days(1),
        percentInBP: vestingPercentage * 3,
        multiplierInBP: BP,
        isFullRefund: false,
        isRefundable: true
      },
      {
        dateRequestStart: vestingDates[2],
        dateRequestEnd: vestingDates[2] + days(1),
        percentInBP: BP,
        multiplierInBP: BP,
        isFullRefund: false,
        isRefundable: true
      }
    ]
    refund = await new OneChainRefundRequester__factory(owner).deploy()
    const initializeRefundInfo: InitializeRefundInfo = {
      token: IDOToken.address,
      identifier: ido.address,
      vesting: vesting.address,
      projectFundsHolder: owner.address,
      KPIs: KPIs,
      bpPrecision: BP
    }

    proxy = await new ERC1967Proxy__factory(owner).deploy(
      refund.address,
      refund.interface.encodeFunctionData('initialize', [
        registry.address,
        initializeRefundInfo,
        ethers.utils.defaultAbiCoder.encode([], [])
      ])
    )
    refund = refund.attach(proxy.address)

    await vesting.setRefund(IDOToken.address, ido.address, refund.address)
  })

  describe('upgradeability', () => {
    let updatedRefund: UpgradedOneChainRefundRequester

    beforeEach(async () => {
      updatedRefund = await new UpgradedOneChainRefundRequester__factory(owner).deploy()
    })

    it('upgrade:successfully', async () => {
      let info = await refund.attach(proxy.address).infoOf(IDOToken.address, ido.address, user.address)
      expect(info.KPIs.length).to.eq(KPIs.length)
      await refund.upgradeTo(updatedRefund.address)
      info = await updatedRefund.attach(proxy.address).infoOf(IDOToken.address, ido.address, user.address)
      expect(info.KPIs.length).to.eq(KPIs.length)
      expect(await updatedRefund.attach(proxy.address).test()).to.eq('Success')
    })

    it('upgrade:forbidden', async () => {
      await expect(refund.connect(user).upgradeTo(updatedRefund.address)).to.revertedWith('BRC:F')
    })

    it('upgrade:wrong interface', async () => {
      await expect(refund.upgradeTo(ido.address)).to.revertedWith('BRR:I')
    })
  })

  describe('initialization', () => {
    it('initialization', async () => {
      const info = await refund.infoOf(IDOToken.address, ido.address, user.address)

      expect(info.bpPrecision).to.eq(bpPrecision)
      expect(info.projectFundsHolder).to.eq(owner.address)
      expect(info.KPIs.length).to.eq(KPIs.length)
      expect(info.totalRefundRequestedByKPI.length).to.eq(KPIs.length)

      // Check account Info Of
      expect(info.accountInfoOf.refundRequestedInToken).to.eq(0)
      expect(info.accountInfoOf.refundRequestedWithMultiplierInToken).to.eq(0)
      expect(info.accountInfoOf.claimedRefundRequestedInToken).to.eq(0)
      expect(info.accountInfoOf.refundRequestedByKPIInToken.length).to.eq(KPIs.length)

      // Check KPIs
      for (let i = 0; i < KPIs.length; i++) {
        expect(info.KPIs[i].dateRequestStart).to.eq(KPIs[i].dateRequestStart)
        expect(info.KPIs[i].dateRequestEnd).to.eq(KPIs[i].dateRequestEnd)
        expect(info.KPIs[i].isFullRefund).to.eq(KPIs[i].isFullRefund)
        expect(info.KPIs[i].multiplierInBP).to.eq(KPIs[i].multiplierInBP)
        expect(info.KPIs[i].percentInBP).to.eq(KPIs[i].percentInBP)
        expect(info.KPIs[i].isRefundable).to.eq(KPIs[i].isRefundable)
      }
    })

    it('initialization:zero token', async () => {
      refund = await new OneChainRefundRequester__factory(owner).deploy()
      const wrongToken = ethers.constants.AddressZero
      const initializeRefundInfo: InitializeRefundInfo = {
        token: wrongToken,
        identifier: ido.address,
        vesting: vesting.address,
        projectFundsHolder: owner.address,
        KPIs: KPIs,
        bpPrecision: BP
      }

      await expect(
        new ERC1967Proxy__factory(owner).deploy(
          refund.address,
          refund.interface.encodeFunctionData('initialize', [
            registry.address,
            initializeRefundInfo,
            ethers.utils.defaultAbiCoder.encode([], [])
          ])
        )
      ).to.revertedWith('BRR:Z')
    })

    it('initialization:zero IDO address', async () => {
      refund = await new OneChainRefundRequester__factory(owner).deploy()
      const wrongIdentifier = ethers.constants.AddressZero
      const initializeRefundInfo: InitializeRefundInfo = {
        token: IDOToken.address,
        identifier: wrongIdentifier,
        vesting: vesting.address,
        projectFundsHolder: owner.address,
        KPIs: KPIs,
        bpPrecision: BP
      }

      await expect(
        new ERC1967Proxy__factory(owner).deploy(
          refund.address,
          refund.interface.encodeFunctionData('initialize', [
            registry.address,
            initializeRefundInfo,
            ethers.utils.defaultAbiCoder.encode([], [])
          ])
        )
      ).to.revertedWith('Address: low-level delegate call failed')
    })

    it('initialization:invalid IDO address', async () => {
      refund = await new OneChainRefundRequester__factory(owner).deploy()
      const wrongIdentifier = IDOToken.address
      const initializeRefundInfo: InitializeRefundInfo = {
        token: IDOToken.address,
        identifier: wrongIdentifier,
        vesting: vesting.address,
        projectFundsHolder: owner.address,
        KPIs: KPIs,
        bpPrecision: BP
      }

      await expect(
        new ERC1967Proxy__factory(owner).deploy(
          refund.address,
          refund.interface.encodeFunctionData('initialize', [
            registry.address,
            initializeRefundInfo,
            ethers.utils.defaultAbiCoder.encode([], [])
          ])
        )
      ).to.revertedWith('Address: low-level delegate call failed')
    })

    it('initialization:zero vesting', async () => {
      refund = await new OneChainRefundRequester__factory(owner).deploy()
      const wrongVesting = ethers.constants.AddressZero
      const initializeRefundInfo: InitializeRefundInfo = {
        token: IDOToken.address,
        identifier: ido.address,
        vesting: wrongVesting,
        projectFundsHolder: owner.address,
        KPIs: KPIs,
        bpPrecision: BP
      }

      await expect(
        new ERC1967Proxy__factory(owner).deploy(
          refund.address,
          refund.interface.encodeFunctionData('initialize', [
            registry.address,
            initializeRefundInfo,
            ethers.utils.defaultAbiCoder.encode([], [])
          ])
        )
      ).to.revertedWith('Address: low-level delegate call failed')
    })

    it('initialization:invalid vesting', async () => {
      refund = await new OneChainRefundRequester__factory(owner).deploy()
      const wrongVesting = IDOToken.address
      const initializeRefundInfo: InitializeRefundInfo = {
        token: IDOToken.address,
        identifier: ido.address,
        vesting: wrongVesting,
        projectFundsHolder: owner.address,
        KPIs: KPIs,
        bpPrecision: BP
      }

      await expect(
        new ERC1967Proxy__factory(owner).deploy(
          refund.address,
          refund.interface.encodeFunctionData('initialize', [
            registry.address,
            initializeRefundInfo,
            ethers.utils.defaultAbiCoder.encode([], [])
          ])
        )
      ).to.revertedWith('Address: low-level delegate call failed')
    })

    it('initialization:zero BP precision', async () => {
      refund = await new OneChainRefundRequester__factory(owner).deploy()

      const wrongBPPrecision = 0

      const initializeRefundInfo: InitializeRefundInfo = {
        token: IDOToken.address,
        identifier: ido.address,
        vesting: vesting.address,
        projectFundsHolder: owner.address,
        KPIs: KPIs,
        bpPrecision: wrongBPPrecision
      }

      await expect(
        new ERC1967Proxy__factory(owner).deploy(
          refund.address,
          refund.interface.encodeFunctionData('initialize', [
            registry.address,
            initializeRefundInfo,
            ethers.utils.defaultAbiCoder.encode([], [])
          ])
        )
      ).to.revertedWith('BRR:Z')
    })

    it('initialization:zero KPIs length', async () => {
      refund = await new OneChainRefundRequester__factory(owner).deploy()
      const emptyKPIs: KPI[] = []
      const initializeRefundInfo: InitializeRefundInfo = {
        token: IDOToken.address,
        identifier: ido.address,
        vesting: vesting.address,
        projectFundsHolder: owner.address,
        KPIs: emptyKPIs,
        bpPrecision: BP
      }

      await expect(
        new ERC1967Proxy__factory(owner).deploy(
          refund.address,
          refund.interface.encodeFunctionData('initialize', [
            registry.address,
            initializeRefundInfo,
            ethers.utils.defaultAbiCoder.encode([], [])
          ])
        )
      ).to.revertedWith('BRR:Z')
    })
  })

  describe('setRefundable', () => {
    it('setRefundable:forbidden', async () => {
      await expect(refund.connect(user).setRefundable(IDOToken.address, ido.address, 0, true)).to.revertedWith('BRC:F')
    })

    it('setRefundable:KPI has already ended', async () => {
      await mineBlockAtTime(ethers.provider, KPIs[2].dateRequestStart)
      await expect(refund.setRefundable(IDOToken.address, ido.address, 0, true)).to.revertedWith('BRR:I')
    })

    it('setRefundable:successfully', async () => {
      const kpiIndex = 2
      await mineBlockAtTime(ethers.provider, KPIs[kpiIndex].dateRequestStart)
      await expect(refund.setRefundable(IDOToken.address, ido.address, kpiIndex, true))
        .to.emit(refund, 'SetRefundable')
        .withArgs(IDOToken.address, ido.address, 2, true)
      const info = await refund.infoOf(IDOToken.address, ido.address, user.address)
      expect(info.KPIs[kpiIndex].isRefundable).to.eq(true)
    })

    it('setRefundable:successfully set false', async () => {
      const kpiIndex = 2
      await mineBlockAtTime(ethers.provider, KPIs[kpiIndex].dateRequestStart)
      await expect(refund.setRefundable(IDOToken.address, ido.address, kpiIndex, false))
        .to.emit(refund, 'SetRefundable')
        .withArgs(IDOToken.address, ido.address, 2, false)
      const info = await refund.infoOf(IDOToken.address, ido.address, user.address)
      expect(info.KPIs[kpiIndex].isRefundable).to.eq(false)
    })
  })

  describe('setProjectFundsHolder', () => {
    it('setProjectFundsHolder:forbidden', async () => {
      await expect(
        refund.connect(user).setProjectFundsHolder(IDOToken.address, ido.address, user.address)
      ).to.revertedWith('BRC:F')
    })

    it('setProjectFundsHolder:zero address', async () => {
      await expect(
        refund.setProjectFundsHolder(IDOToken.address, ido.address, ethers.constants.AddressZero)
      ).to.revertedWith('BRR:Z')
    })

    it('setProjectFundsHolder:success', async () => {
      let info = await refund.infoOf(IDOToken.address, ido.address, user.address)
      expect(info.projectFundsHolder).to.eq(owner.address)

      await expect(refund.setProjectFundsHolder(IDOToken.address, ido.address, user.address))
        .to.emit(refund, 'SetProjectFundsHolder')
        .withArgs(IDOToken.address, ido.address, user.address)

      info = await refund.infoOf(IDOToken.address, ido.address, user.address)
      expect(info.projectFundsHolder).to.eq(user.address)
    })
  })

  describe('setKPI', () => {
    it('setKPI:forbidden', async () => {
      await expect(refund.connect(user).setKPI(IDOToken.address, ido.address, 0, KPIs[0])).to.revertedWith('BRC:F')
    })

    it('setKPI:time passed', async () => {
      await mineBlockAtTime(ethers.provider, KPIs[1].dateRequestStart)
      await expect(refund.setKPI(IDOToken.address, ido.address, 0, KPIs[0])).to.revertedWith('BRR:I')
    })

    it('setKPI:wrong date range', async () => {
      const wrongDateRequestEnd = KPIs[0].dateRequestStart - 1
      const KPI: KPI = { ...KPIs[0], dateRequestEnd: wrongDateRequestEnd }
      await expect(refund.setKPI(IDOToken.address, ido.address, 0, KPI)).to.revertedWith('BRR:I')
    })

    it('setKPI:wrong percent for full refund', async () => {
      const wrongPercentInBP = 9900
      const KPI: KPI = { ...KPIs[0], percentInBP: wrongPercentInBP }
      await expect(refund.setKPI(IDOToken.address, ido.address, 0, KPI)).to.revertedWith('BRR:I')
    })

    it('setKPI:wrong percent for last one', async () => {
      const kpiIndex = KPIs.length - 1
      const wrongPercentInBP = 9900
      const KPI: KPI = { ...KPIs[kpiIndex], percentInBP: wrongPercentInBP }
      await expect(refund.setKPI(IDOToken.address, ido.address, kpiIndex, KPI)).to.revertedWith('BRR:I')
    })

    it('setKPI:wrong new KPI dateRequestStart', async () => {
      const kpiIndex = 1
      const wrongStartDate = KPIs[kpiIndex - 1].dateRequestEnd - 1
      const KPI: KPI = { ...KPIs[kpiIndex], dateRequestStart: wrongStartDate }
      await expect(refund.setKPI(IDOToken.address, ido.address, kpiIndex, KPI)).to.revertedWith('BRR:I')
    })

    it('setKPI:wrong new KPI dateRequestEnd', async () => {
      const kpiIndex = 1
      const wrongEndDate = KPIs[kpiIndex + 1].dateRequestStart + 10
      const KPI: KPI = { ...KPIs[kpiIndex], dateRequestEnd: wrongEndDate }
      await expect(refund.setKPI(IDOToken.address, ido.address, kpiIndex, KPI)).to.revertedWith('BRR:I')
    })

    it('setKPI:KPIs percentInBP less than prev percentInBP', async () => {
      const kpiIndex = 2
      const wrongPercentInBP = KPIs[kpiIndex - 1].percentInBP - 1
      const KPI: KPI = { ...KPIs[kpiIndex], percentInBP: wrongPercentInBP }
      await expect(refund.setKPI(IDOToken.address, ido.address, kpiIndex, KPI)).to.revertedWith('BRR:I')
    })

    it('setKPI:successfully', async () => {
      const kpiIndex = 2
      const KPI: KPI = { ...KPIs[kpiIndex] }
      await expect(refund.setKPI(IDOToken.address, ido.address, kpiIndex, KPI))
        .to.emit(refund, 'SetKPI')
        .withArgs(
          IDOToken.address,
          ido.address,
          kpiIndex,
          KPI.dateRequestStart,
          KPI.dateRequestEnd,
          KPI.percentInBP,
          KPI.multiplierInBP,
          KPI.isFullRefund,
          KPI.isRefundable
        )
    })
  })

  describe('bpPrecision', () => {
    beforeEach(async () => {
      const now = await latestBlockTimestamp(ethers.provider)
      bpPrecision = 100_000
      tgePercentage = 25_000 // 25%
      tgeDate = now + hours(3)
      vestingPercentage = 25_000 // 25%

      // Vesting
      vesting = await new OneChainDatesRefundVesting__factory(owner).deploy()
      const initializeVestingInfo: InitializeVestingInfo = {
        token: IDOToken.address,
        identifier: ido.address,
        refund: ethers.constants.AddressZero
      }

      proxy = await new ERC1967Proxy__factory(owner).deploy(
        vesting.address,
        vesting.interface.encodeFunctionData('initialize', [
          registry.address,
          initializeVestingInfo,
          ethers.utils.defaultAbiCoder.encode(
            ['uint64', 'uint64', 'uint32', 'uint32[]'],
            [bpPrecision, tgePercentage, tgeDate, vestingDates]
          )
        ])
      )
      vesting = vesting.attach(proxy.address)

      // Refund requester
      KPIs = [
        {
          dateRequestStart: tgeDate,
          dateRequestEnd: tgeDate + days(1),
          percentInBP: 0,
          multiplierInBP: bpPrecision,
          isFullRefund: true,
          isRefundable: true
        },
        {
          dateRequestStart: vestingDates[0],
          dateRequestEnd: vestingDates[0] + days(1),
          percentInBP: vestingPercentage * 2,
          multiplierInBP: bpPrecision,
          isFullRefund: false,
          isRefundable: true
        },
        {
          dateRequestStart: vestingDates[1],
          dateRequestEnd: vestingDates[1] + days(1),
          percentInBP: vestingPercentage * 3,
          multiplierInBP: bpPrecision,
          isFullRefund: false,
          isRefundable: true
        },
        {
          dateRequestStart: vestingDates[2],
          dateRequestEnd: vestingDates[2] + days(1),
          percentInBP: bpPrecision,
          multiplierInBP: bpPrecision,
          isFullRefund: false,
          isRefundable: true
        }
      ]
      refund = await new OneChainRefundRequester__factory(owner).deploy()
      const initializeRefundInfo: InitializeRefundInfo = {
        token: IDOToken.address,
        identifier: ido.address,
        vesting: vesting.address,
        projectFundsHolder: owner.address,
        KPIs: KPIs,
        bpPrecision: bpPrecision
      }

      proxy = await new ERC1967Proxy__factory(owner).deploy(
        refund.address,
        refund.interface.encodeFunctionData('initialize', [
          registry.address,
          initializeRefundInfo,
          ethers.utils.defaultAbiCoder.encode([], [])
        ])
      )
      refund = refund.attach(proxy.address)

      await vesting.setRefund(IDOToken.address, ido.address, refund.address)
    })

    it('requestRefund:1st full refund:with claim in 1 tx', async () => {
      await mineBlockAtTime(ethers.provider, KPIs[0].dateRequestStart)
      await IDOToken.transfer(vesting.address, userAmountInIDOToken)

      // User claim tokens
      await vesting.connect(user).withdraw(IDOToken.address, ido.address)

      // User asks for refund
      const userBalanceInToken = await IDOToken.balanceOf(user.address)
      await IDOToken.connect(user).approve(refund.address, userBalanceInToken)

      await expect(refund.connect(user).requestRefund(IDOToken.address, ido.address, userBalanceInToken, 0, zeroData))
        .to.emit(refund, 'RequestRefund')
        .withArgs(IDOToken.address, ido.address, user.address, userAmountInIDOToken, userBalanceInToken, 0)

      expect(await IDOToken.balanceOf(user.address)).to.eq(0)

      // Check info
      const refundInfo = await refund.infoOf(IDOToken.address, ido.address, user.address)
      expect(refundInfo.accountInfoOf.refundRequestedInToken).to.eq(userAmountInIDOToken)
      expect(refundInfo.accountInfoOf.refundRequestedWithMultiplierInToken).to.eq(userAmountInIDOToken)
      expect(refundInfo.accountInfoOf.claimedRefundRequestedInToken).to.eq(userBalanceInToken)
      expect(refundInfo.accountInfoOf.refundRequestedByKPIInToken[0]).to.eq(userAmountInIDOToken)

      // Try to claim tokens
      const vestingInfo = await vesting.infoOf(IDOToken.address, ido.address, user.address)
      expect(vestingInfo.refundInfo.total).to.eq(userAmountInIDOToken)
      expect(vestingInfo.refundInfo.totalClaimed).to.eq(userBalanceInToken)
      expect(vestingInfo.refundInfo.withdrawableAmount).to.eq(0)

      await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address)).to.be.revertedWith('BRV:Z')
    })
  })

  describe('requestRefund', () => {
    it('requestRefund:before start', async () => {
      await expect(refund.connect(user).requestRefund(IDOToken.address, ido.address, 0, 0, zeroData)).to.revertedWith(
        'BRR:I'
      )
    })

    it('requestRefund:after end', async () => {
      await mineBlockAtTime(ethers.provider, KPIs[0].dateRequestEnd + hours(1))
      await expect(refund.connect(user).requestRefund(IDOToken.address, ido.address, 0, 0, zeroData)).to.revertedWith(
        'BRR:I'
      )
    })

    it('requestRefund:no allocation', async () => {
      await mineBlockAtTime(ethers.provider, KPIs[0].dateRequestStart)
      await expect(refund.connect(owner).requestRefund(IDOToken.address, ido.address, 0, 0, zeroData)).to.revertedWith(
        'BRR:I'
      )
    })

    it('requestRefund:1st full refund:no claim', async () => {
      await mineBlockAtTime(ethers.provider, KPIs[0].dateRequestStart)

      const userBalanceInToken = await IDOToken.balanceOf(user.address)

      await expect(refund.connect(user).requestRefund(IDOToken.address, ido.address, 0, 0, zeroData))
        .to.emit(refund, 'RequestRefund')
        .withArgs(IDOToken.address, ido.address, user.address, userAmountInIDOToken, 0, 0)

      expect(await IDOToken.balanceOf(user.address)).to.eq(userBalanceInToken)

      // Check info
      const refundInfo = await refund.infoOf(IDOToken.address, ido.address, user.address)
      expect(refundInfo.accountInfoOf.refundRequestedInToken).to.eq(userAmountInIDOToken)
      expect(refundInfo.accountInfoOf.refundRequestedWithMultiplierInToken).to.eq(userAmountInIDOToken)
      expect(refundInfo.accountInfoOf.claimedRefundRequestedInToken).to.eq(0)
      expect(refundInfo.accountInfoOf.refundRequestedByKPIInToken[0]).to.eq(userAmountInIDOToken)

      // Try to claim tokens
      const vestingInfo = await vesting.infoOf(IDOToken.address, ido.address, user.address)
      expect(vestingInfo.refundInfo.total).to.eq(userAmountInIDOToken)
      expect(vestingInfo.refundInfo.totalClaimed).to.eq(0)
      expect(vestingInfo.refundInfo.withdrawableAmount).to.eq(0)

      await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address)).to.be.revertedWith('BRV:Z')
    })

    it('requestRefund:refund each:no claim:try refund more', async () => {
      for (let kpiIndex = 0; kpiIndex < KPIs.length; kpiIndex++) {
        await mineBlockAtTime(ethers.provider, KPIs[kpiIndex].dateRequestStart)

        const tryToRefund = expandTo18Decimals(100)
        await IDOToken.transfer(user.address, tryToRefund)
        await IDOToken.connect(user).approve(refund.address, tryToRefund)

        await expect(
          refund.connect(user).requestRefund(IDOToken.address, ido.address, tryToRefund, kpiIndex, zeroData)
        ).to.be.revertedWith('BRR:I')
      }
    })

    it('requestRefund:1st full refund:refund twice', async () => {
      await mineBlockAtTime(ethers.provider, KPIs[0].dateRequestStart)

      await refund.connect(user).requestRefund(IDOToken.address, ido.address, 0, 0, zeroData)

      await expect(
        refund.connect(user).requestRefund(IDOToken.address, ido.address, 0, 0, zeroData)
      ).to.be.revertedWith('BRR:I')
    })

    it('requestRefund:1st full refund:try to withdraw', async () => {
      await mineBlockAtTime(ethers.provider, KPIs[0].dateRequestStart)

      await refund.connect(user).requestRefund(IDOToken.address, ido.address, 0, 0, zeroData)
      await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address)).to.be.revertedWith('BRV:Z')

      for (let i = 1; i < KPIs.length; ++i) {
        await mineBlockAtTime(ethers.provider, KPIs[i].dateRequestStart)
        await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address)).to.be.revertedWith('BRV:Z')
      }
    })

    it('requestRefund:1st full refund:with claim in 1 tx', async () => {
      await mineBlockAtTime(ethers.provider, KPIs[0].dateRequestStart)
      await IDOToken.transfer(vesting.address, userAmountInIDOToken)

      // User claim tokens
      await vesting.connect(user).withdraw(IDOToken.address, ido.address)

      // User asks for refund
      const userBalanceInToken = await IDOToken.balanceOf(user.address)
      await IDOToken.connect(user).approve(refund.address, userBalanceInToken)

      await expect(refund.connect(user).requestRefund(IDOToken.address, ido.address, userBalanceInToken, 0, zeroData))
        .to.emit(refund, 'RequestRefund')
        .withArgs(IDOToken.address, ido.address, user.address, userAmountInIDOToken, userBalanceInToken, 0)

      expect(await IDOToken.balanceOf(user.address)).to.eq(0)

      // Check info
      const refundInfo = await refund.infoOf(IDOToken.address, ido.address, user.address)
      expect(refundInfo.accountInfoOf.refundRequestedInToken).to.eq(userAmountInIDOToken)
      expect(refundInfo.accountInfoOf.refundRequestedWithMultiplierInToken).to.eq(userAmountInIDOToken)
      expect(refundInfo.accountInfoOf.claimedRefundRequestedInToken).to.eq(userBalanceInToken)
      expect(refundInfo.accountInfoOf.refundRequestedByKPIInToken[0]).to.eq(userAmountInIDOToken)

      // Try to claim tokens
      const vestingInfo = await vesting.infoOf(IDOToken.address, ido.address, user.address)
      expect(vestingInfo.refundInfo.total).to.eq(userAmountInIDOToken)
      expect(vestingInfo.refundInfo.totalClaimed).to.eq(userBalanceInToken)
      expect(vestingInfo.refundInfo.withdrawableAmount).to.eq(0)

      await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address)).to.be.revertedWith('BRV:Z')
    })

    it('requestRefund:1st full refund:with claim in 2 tx', async () => {
      await mineBlockAtTime(ethers.provider, KPIs[0].dateRequestStart)
      await IDOToken.transfer(vesting.address, userAmountInIDOToken)

      // User claim tokens
      await vesting.connect(user).withdraw(IDOToken.address, ido.address)

      // User asks for refund
      const claimedTokens = await IDOToken.balanceOf(user.address)
      const expectedRefund = userAmountInIDOToken.sub(claimedTokens)

      await expect(refund.connect(user).requestRefund(IDOToken.address, ido.address, 0, 0, zeroData))
        .to.emit(refund, 'RequestRefund')
        .withArgs(IDOToken.address, ido.address, user.address, expectedRefund, 0, 0)

      expect(await IDOToken.balanceOf(user.address)).to.eq(claimedTokens)

      // Check info
      let refundInfo = await refund.infoOf(IDOToken.address, ido.address, user.address)
      expect(refundInfo.accountInfoOf.refundRequestedInToken).to.eq(expectedRefund)
      expect(refundInfo.accountInfoOf.refundRequestedWithMultiplierInToken).to.eq(expectedRefund)
      expect(refundInfo.accountInfoOf.claimedRefundRequestedInToken).to.eq(0)
      expect(refundInfo.accountInfoOf.refundRequestedByKPIInToken[0]).to.eq(expectedRefund)

      // Try to claim tokens
      const vestingInfo = await vesting.infoOf(IDOToken.address, ido.address, user.address)
      expect(vestingInfo.refundInfo.total).to.eq(userAmountInIDOToken)
      expect(vestingInfo.refundInfo.totalClaimed).to.eq(claimedTokens)
      expect(vestingInfo.refundInfo.withdrawableAmount).to.eq(0)

      await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address)).to.be.revertedWith('BRV:Z')

      // Refund other part of tokens
      await IDOToken.connect(user).approve(refund.address, claimedTokens)

      await expect(refund.connect(user).requestRefund(IDOToken.address, ido.address, claimedTokens, 0, zeroData))
        .to.emit(refund, 'RequestRefund')
        .withArgs(IDOToken.address, ido.address, user.address, claimedTokens, claimedTokens, 0)

      expect(await IDOToken.balanceOf(user.address)).to.eq(0)

      // Check info
      refundInfo = await refund.infoOf(IDOToken.address, ido.address, user.address)
      expect(refundInfo.accountInfoOf.refundRequestedInToken).to.eq(userAmountInIDOToken)
      expect(refundInfo.accountInfoOf.refundRequestedWithMultiplierInToken).to.eq(userAmountInIDOToken)
      expect(refundInfo.accountInfoOf.claimedRefundRequestedInToken).to.eq(claimedTokens)
      expect(refundInfo.accountInfoOf.refundRequestedByKPIInToken[0]).to.eq(userAmountInIDOToken)
    })

    it('requestRefund:1st full refund:with claim in 3 tx', async () => {
      await mineBlockAtTime(ethers.provider, KPIs[0].dateRequestStart)
      await IDOToken.transfer(vesting.address, userAmountInIDOToken)

      // User claim tokens
      await vesting.connect(user).withdraw(IDOToken.address, ido.address)
      const claimedTokens = await IDOToken.balanceOf(user.address)

      // User asks for refund 1
      await refund.connect(user).requestRefund(IDOToken.address, ido.address, 0, 0, zeroData)

      // User asks for refund 2
      const refundClaimedTokens2 = claimedTokens.div(2)
      const refundClaimedTokens3 = claimedTokens.sub(refundClaimedTokens2)
      await IDOToken.connect(user).approve(refund.address, claimedTokens)

      await expect(refund.connect(user).requestRefund(IDOToken.address, ido.address, refundClaimedTokens2, 0, zeroData))
        .to.emit(refund, 'RequestRefund')
        .withArgs(IDOToken.address, ido.address, user.address, refundClaimedTokens2, refundClaimedTokens2, 0)

      expect(await IDOToken.balanceOf(user.address)).to.eq(refundClaimedTokens3)

      const totalExpectedRefund = userAmountInIDOToken.sub(refundClaimedTokens3)

      // Check info
      let refundInfo = await refund.infoOf(IDOToken.address, ido.address, user.address)
      expect(refundInfo.accountInfoOf.refundRequestedInToken).to.eq(totalExpectedRefund)
      expect(refundInfo.accountInfoOf.refundRequestedWithMultiplierInToken).to.eq(totalExpectedRefund)
      expect(refundInfo.accountInfoOf.claimedRefundRequestedInToken).to.eq(refundClaimedTokens2)
      expect(refundInfo.accountInfoOf.refundRequestedByKPIInToken[0]).to.eq(totalExpectedRefund)

      // User asks for refund 3
      await expect(refund.connect(user).requestRefund(IDOToken.address, ido.address, refundClaimedTokens3, 0, zeroData))
        .to.emit(refund, 'RequestRefund')
        .withArgs(IDOToken.address, ido.address, user.address, refundClaimedTokens3, refundClaimedTokens3, 0)

      // Check info
      refundInfo = await refund.infoOf(IDOToken.address, ido.address, user.address)
      expect(refundInfo.accountInfoOf.refundRequestedInToken).to.eq(userAmountInIDOToken)
      expect(refundInfo.accountInfoOf.refundRequestedWithMultiplierInToken).to.eq(userAmountInIDOToken)
      expect(refundInfo.accountInfoOf.claimedRefundRequestedInToken).to.eq(claimedTokens)
      expect(refundInfo.accountInfoOf.refundRequestedByKPIInToken[0]).to.eq(userAmountInIDOToken)

      // Try to claim tokens
      const vestingInfo = await vesting.infoOf(IDOToken.address, ido.address, user.address)
      expect(vestingInfo.refundInfo.total).to.eq(userAmountInIDOToken)
      expect(vestingInfo.refundInfo.totalClaimed).to.eq(claimedTokens)
      expect(vestingInfo.refundInfo.withdrawableAmount).to.eq(0)

      // User asks for invalid refund 4
      await IDOToken.transfer(vesting.address, userAmountInIDOToken)
      await IDOToken.connect(user).approve(refund.address, claimedTokens)

      await expect(
        refund.connect(user).requestRefund(IDOToken.address, ido.address, userAmountInIDOToken, 0, zeroData)
      ).to.be.revertedWith('BRR:I')
    })

    it('requestRefund:claim:1st full refund:try to withdraw', async () => {
      await mineBlockAtTime(ethers.provider, KPIs[0].dateRequestStart)
      await IDOToken.transfer(vesting.address, userAmountInIDOToken)

      await vesting.connect(user).withdraw(IDOToken.address, ido.address)
      const userBalanceInToken = await IDOToken.balanceOf(user.address)
      await IDOToken.connect(user).approve(refund.address, userBalanceInToken)

      await refund.connect(user).requestRefund(IDOToken.address, ido.address, userBalanceInToken, 0, zeroData)
      await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address)).to.be.revertedWith('BRV:Z')

      for (let i = 1; i < KPIs.length; ++i) {
        await mineBlockAtTime(ethers.provider, KPIs[i].dateRequestStart)
        await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address)).to.be.revertedWith('BRV:Z')
      }
    })

    it('requestRefund:refund all other refunds:no claim', async () => {
      let userTotalInIDOToken = BigNumber.from(0)
      for (let i = 1; i < KPIs.length; i++) {
        await mineBlockAtTime(ethers.provider, KPIs[i].dateRequestStart)

        const prevKPI = KPIs[i - 1]
        let percentInBP = KPIs[i].percentInBP
        if (!prevKPI.isFullRefund) {
          percentInBP = percentInBP - prevKPI.percentInBP
        }
        const amountInIDOToken = userAmountInIDOToken.mul(percentInBP).div(bpPrecision)
        const userBalanceInToken = await IDOToken.balanceOf(user.address)

        await expect(refund.connect(user).requestRefund(IDOToken.address, ido.address, 0, i, zeroData))
          .to.emit(refund, 'RequestRefund')
          .withArgs(IDOToken.address, ido.address, user.address, amountInIDOToken, 0, i)

        userTotalInIDOToken = userTotalInIDOToken.add(amountInIDOToken)
        expect(await IDOToken.balanceOf(user.address)).to.eq(userBalanceInToken)

        // Check info
        const refundInfo = await refund.infoOf(IDOToken.address, ido.address, user.address)
        expect(refundInfo.accountInfoOf.refundRequestedInToken).to.eq(userTotalInIDOToken)
        expect(refundInfo.accountInfoOf.refundRequestedWithMultiplierInToken).to.eq(userTotalInIDOToken)
        expect(refundInfo.accountInfoOf.claimedRefundRequestedInToken).to.eq(0)
        expect(refundInfo.accountInfoOf.refundRequestedByKPIInToken[i]).to.eq(amountInIDOToken)

        // Try to claim tokens
        const vestingInfo = await vesting.infoOf(IDOToken.address, ido.address, user.address)
        expect(vestingInfo.refundInfo.total).to.eq(userAmountInIDOToken)
        expect(vestingInfo.refundInfo.totalClaimed).to.eq(0)
        expect(vestingInfo.refundInfo.withdrawableAmount).to.eq(0)

        await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address)).to.be.revertedWith('BRV:Z')
      }
    })

    it('requestRefund:refund all other KPIs:refund twice', async () => {
      for (let kpiIndex = 1; kpiIndex < KPIs.length; kpiIndex++) {
        await mineBlockAtTime(ethers.provider, KPIs[kpiIndex].dateRequestStart)

        await refund.connect(user).requestRefund(IDOToken.address, ido.address, 0, kpiIndex, zeroData)

        await expect(
          refund.connect(user).requestRefund(IDOToken.address, ido.address, 0, kpiIndex, zeroData)
        ).to.be.revertedWith('BRR:I')
      }
    })

    it('requestRefund:refund from 2 to last KPIs:try to withdraw', async () => {
      for (let kpiIndex = 1; kpiIndex < KPIs.length; kpiIndex++) {
        await mineBlockAtTime(ethers.provider, KPIs[kpiIndex].dateRequestStart)

        await refund.connect(user).requestRefund(IDOToken.address, ido.address, 0, kpiIndex, zeroData)
        await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address)).to.be.revertedWith('BRV:Z')
      }
      const lastKPIIndex = KPIs.length - 1
      await expect(
        refund.connect(user).requestRefund(IDOToken.address, ido.address, 0, lastKPIIndex, zeroData)
      ).to.be.revertedWith('BRR:I')
      await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address)).to.be.revertedWith('BRV:Z')
    })

    it('requestRefund:refund 2 KPI:withdraw at the end', async () => {})

    it('requestRefund:refund not full refund KPIs:claim in 1 tx', async () => {
      let totalUserAmountInIDOToken = BigNumber.from(0)
      for (let kpiIndex = 1; kpiIndex < KPIs.length; kpiIndex++) {
        const prevKPI = KPIs[kpiIndex - 1]
        let percentInBP = KPIs[kpiIndex].percentInBP
        if (!prevKPI.isFullRefund) {
          percentInBP = percentInBP - prevKPI.percentInBP
        }
        const amountInIDOToken = userAmountInIDOToken.mul(percentInBP).div(bpPrecision)
        await mineBlockAtTime(ethers.provider, KPIs[kpiIndex].dateRequestStart)
        await IDOToken.transfer(vesting.address, amountInIDOToken)

        // User claim tokens
        await vesting.connect(user).withdraw(IDOToken.address, ido.address)

        // User asks for refund
        const userBalanceInToken = await IDOToken.balanceOf(user.address)
        await IDOToken.connect(user).approve(refund.address, userBalanceInToken)

        await expect(
          refund.connect(user).requestRefund(IDOToken.address, ido.address, userBalanceInToken, kpiIndex, zeroData)
        )
          .to.emit(refund, 'RequestRefund')
          .withArgs(IDOToken.address, ido.address, user.address, amountInIDOToken, userBalanceInToken, kpiIndex)
        totalUserAmountInIDOToken = totalUserAmountInIDOToken.add(amountInIDOToken)

        expect(await IDOToken.balanceOf(user.address)).to.eq(0)

        // Check info
        const refundInfo = await refund.infoOf(IDOToken.address, ido.address, user.address)
        expect(refundInfo.accountInfoOf.refundRequestedInToken).to.eq(totalUserAmountInIDOToken)
        expect(refundInfo.accountInfoOf.refundRequestedWithMultiplierInToken).to.eq(totalUserAmountInIDOToken)
        expect(refundInfo.accountInfoOf.claimedRefundRequestedInToken).to.eq(totalUserAmountInIDOToken)
        expect(refundInfo.accountInfoOf.refundRequestedByKPIInToken[kpiIndex]).to.eq(amountInIDOToken)

        // Try to claim tokens
        const vestingInfo = await vesting.infoOf(IDOToken.address, ido.address, user.address)
        expect(vestingInfo.refundInfo.total).to.eq(userAmountInIDOToken)
        expect(vestingInfo.refundInfo.totalClaimed).to.eq(totalUserAmountInIDOToken)
        expect(vestingInfo.refundInfo.withdrawableAmount).to.eq(0)

        await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address)).to.be.revertedWith('BRV:Z')
      }
    })

    it('requestRefund:refund not full refund KPIs:claim in 2 tx', async () => {
      await IDOToken.transfer(vesting.address, userAmountInIDOToken)

      let totalUserAmountInIDOToken = BigNumber.from(0)
      let totalClaimedInIDOToken = BigNumber.from(0)
      for (let kpiIndex = 1; kpiIndex < KPIs.length; kpiIndex++) {
        await mineBlockAtTime(ethers.provider, KPIs[kpiIndex].dateRequestStart)

        const prevKPI = KPIs[kpiIndex - 1]
        let percentInBP = KPIs[kpiIndex].percentInBP
        if (!prevKPI.isFullRefund) {
          percentInBP = percentInBP - prevKPI.percentInBP
        }
        // const amountInIDOToken = userAmountInIDOToken.mul(percentInBP).div(bpPrecision)

        // User claim tokens
        await vesting.connect(user).withdraw(IDOToken.address, ido.address)

        // User asks for refund
        const claimedTokens = await IDOToken.balanceOf(user.address)
        totalClaimedInIDOToken = totalClaimedInIDOToken.add(claimedTokens)

        await expect(
          refund.connect(user).requestRefund(IDOToken.address, ido.address, 0, kpiIndex, zeroData)
        ).to.be.revertedWith('BRR:I')

        expect(await IDOToken.balanceOf(user.address)).to.eq(claimedTokens)

        const expectedRefund1 = claimedTokens.div(2).sub(100)
        const expectedRefund2 = claimedTokens.div(2).add(100)

        await IDOToken.connect(user).approve(refund.address, expectedRefund1)

        await expect(
          refund.connect(user).requestRefund(IDOToken.address, ido.address, expectedRefund1, kpiIndex, zeroData)
        )
          .to.emit(refund, 'RequestRefund')
          .withArgs(IDOToken.address, ido.address, user.address, expectedRefund1, expectedRefund1, kpiIndex)
        totalUserAmountInIDOToken = totalUserAmountInIDOToken.add(expectedRefund1)

        expect(await IDOToken.balanceOf(user.address)).to.eq(claimedTokens.sub(expectedRefund1))

        // Check info
        let refundInfo = await refund.infoOf(IDOToken.address, ido.address, user.address)
        expect(refundInfo.accountInfoOf.refundRequestedInToken).to.eq(totalUserAmountInIDOToken)
        expect(refundInfo.accountInfoOf.refundRequestedWithMultiplierInToken).to.eq(totalUserAmountInIDOToken)
        expect(refundInfo.accountInfoOf.claimedRefundRequestedInToken).to.eq(totalUserAmountInIDOToken)
        expect(refundInfo.accountInfoOf.refundRequestedByKPIInToken[kpiIndex]).to.eq(expectedRefund1)

        // Try to claim tokens
        const vestingInfo = await vesting.infoOf(IDOToken.address, ido.address, user.address)
        expect(vestingInfo.refundInfo.total).to.eq(userAmountInIDOToken)
        expect(vestingInfo.refundInfo.totalClaimed).to.eq(totalClaimedInIDOToken)
        expect(vestingInfo.refundInfo.withdrawableAmount).to.eq(0)

        await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address)).to.be.revertedWith('BRV:Z')

        // Refund other part of tokens
        await IDOToken.connect(user).approve(refund.address, expectedRefund2)

        await expect(
          refund.connect(user).requestRefund(IDOToken.address, ido.address, expectedRefund2, kpiIndex, zeroData)
        )
          .to.emit(refund, 'RequestRefund')
          .withArgs(IDOToken.address, ido.address, user.address, expectedRefund2, expectedRefund2, kpiIndex)
        totalUserAmountInIDOToken = totalUserAmountInIDOToken.add(expectedRefund2)

        expect(await IDOToken.balanceOf(user.address)).to.eq(0)

        // Check info
        refundInfo = await refund.infoOf(IDOToken.address, ido.address, user.address)
        expect(refundInfo.accountInfoOf.refundRequestedInToken).to.eq(totalClaimedInIDOToken)
        expect(refundInfo.accountInfoOf.refundRequestedWithMultiplierInToken).to.eq(totalClaimedInIDOToken)
        expect(refundInfo.accountInfoOf.claimedRefundRequestedInToken).to.eq(totalClaimedInIDOToken)
        expect(refundInfo.accountInfoOf.refundRequestedByKPIInToken[kpiIndex]).to.eq(claimedTokens)
      }
    })

    it('requestRefund:not full refund KPIs:claim in 3 tx', async () => {
      await IDOToken.transfer(vesting.address, userAmountInIDOToken)

      let totalUserAmountInIDOToken = BigNumber.from(0)
      let totalClaimedInIDOToken = BigNumber.from(0)
      for (let kpiIndex = 1; kpiIndex < KPIs.length; kpiIndex++) {
        await mineBlockAtTime(ethers.provider, KPIs[kpiIndex].dateRequestStart)

        let totalUserAmountForKPIInIDOToken = BigNumber.from(0)

        const prevKPI = KPIs[kpiIndex - 1]
        let percentInBP = KPIs[kpiIndex].percentInBP
        if (!prevKPI.isFullRefund) {
          percentInBP = percentInBP - prevKPI.percentInBP
        }

        // User claim tokens
        await vesting.connect(user).withdraw(IDOToken.address, ido.address)

        // User asks for refund
        const claimedTokens = await IDOToken.balanceOf(user.address)
        totalClaimedInIDOToken = totalClaimedInIDOToken.add(claimedTokens)

        await expect(
          refund.connect(user).requestRefund(IDOToken.address, ido.address, 0, kpiIndex, zeroData)
        ).to.be.revertedWith('BRR:I')

        expect(await IDOToken.balanceOf(user.address)).to.eq(claimedTokens)

        const expectedRefund1 = claimedTokens.div(3).sub(100)
        const expectedRefund2 = claimedTokens.div(3).add(100)
        const expectedRefund3 = claimedTokens.sub(expectedRefund1).sub(expectedRefund2)

        await IDOToken.connect(user).approve(refund.address, expectedRefund1)

        await expect(
          refund.connect(user).requestRefund(IDOToken.address, ido.address, expectedRefund1, kpiIndex, zeroData)
        )
          .to.emit(refund, 'RequestRefund')
          .withArgs(IDOToken.address, ido.address, user.address, expectedRefund1, expectedRefund1, kpiIndex)
        totalUserAmountInIDOToken = totalUserAmountInIDOToken.add(expectedRefund1)
        totalUserAmountForKPIInIDOToken = totalUserAmountForKPIInIDOToken.add(expectedRefund1)

        expect(await IDOToken.balanceOf(user.address)).to.eq(claimedTokens.sub(expectedRefund1))

        // Check info
        let refundInfo = await refund.infoOf(IDOToken.address, ido.address, user.address)
        expect(refundInfo.accountInfoOf.refundRequestedInToken).to.eq(totalUserAmountInIDOToken)
        expect(refundInfo.accountInfoOf.refundRequestedWithMultiplierInToken).to.eq(totalUserAmountInIDOToken)
        expect(refundInfo.accountInfoOf.claimedRefundRequestedInToken).to.eq(totalUserAmountInIDOToken)
        expect(refundInfo.accountInfoOf.refundRequestedByKPIInToken[kpiIndex]).to.eq(expectedRefund1)

        // Try to claim tokens
        const vestingInfo = await vesting.infoOf(IDOToken.address, ido.address, user.address)
        expect(vestingInfo.refundInfo.total).to.eq(userAmountInIDOToken)
        expect(vestingInfo.refundInfo.totalClaimed).to.eq(totalClaimedInIDOToken)
        expect(vestingInfo.refundInfo.withdrawableAmount).to.eq(0)

        await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address)).to.be.revertedWith('BRV:Z')

        // Refund second part of tokens
        await IDOToken.connect(user).approve(refund.address, expectedRefund2)

        await expect(
          refund.connect(user).requestRefund(IDOToken.address, ido.address, expectedRefund2, kpiIndex, zeroData)
        )
          .to.emit(refund, 'RequestRefund')
          .withArgs(IDOToken.address, ido.address, user.address, expectedRefund2, expectedRefund2, kpiIndex)
        totalUserAmountInIDOToken = totalUserAmountInIDOToken.add(expectedRefund2)
        totalUserAmountForKPIInIDOToken = totalUserAmountForKPIInIDOToken.add(expectedRefund2)

        expect(await IDOToken.balanceOf(user.address)).to.eq(expectedRefund3)

        // Check info
        refundInfo = await refund.infoOf(IDOToken.address, ido.address, user.address)
        expect(refundInfo.accountInfoOf.refundRequestedInToken).to.eq(totalUserAmountInIDOToken)
        expect(refundInfo.accountInfoOf.refundRequestedWithMultiplierInToken).to.eq(totalUserAmountInIDOToken)
        expect(refundInfo.accountInfoOf.claimedRefundRequestedInToken).to.eq(totalUserAmountInIDOToken)
        expect(refundInfo.accountInfoOf.refundRequestedByKPIInToken[kpiIndex]).to.eq(totalUserAmountForKPIInIDOToken)

        // Refund other part of tokens
        await IDOToken.connect(user).approve(refund.address, expectedRefund3)

        await expect(
          refund.connect(user).requestRefund(IDOToken.address, ido.address, expectedRefund3, kpiIndex, zeroData)
        )
          .to.emit(refund, 'RequestRefund')
          .withArgs(IDOToken.address, ido.address, user.address, expectedRefund3, expectedRefund3, kpiIndex)
        totalUserAmountInIDOToken = totalUserAmountInIDOToken.add(expectedRefund3)

        expect(await IDOToken.balanceOf(user.address)).to.eq(0)

        // Check info
        refundInfo = await refund.infoOf(IDOToken.address, ido.address, user.address)
        expect(refundInfo.accountInfoOf.refundRequestedInToken).to.eq(totalClaimedInIDOToken)
        expect(refundInfo.accountInfoOf.refundRequestedWithMultiplierInToken).to.eq(totalClaimedInIDOToken)
        expect(refundInfo.accountInfoOf.claimedRefundRequestedInToken).to.eq(totalClaimedInIDOToken)
        expect(refundInfo.accountInfoOf.refundRequestedByKPIInToken[kpiIndex]).to.eq(claimedTokens)
      }
    })

    it('requestRefund:refund 2 KPI no claim:claim 3 and 4 KPIs:refund 4 KPI', async () => {
      let totalClaimedInIDOToken = BigNumber.from(0)
      let totalRefundRequestedInToken = BigNumber.from(0)

      let kpiIndex = 1
      await mineBlockAtTime(ethers.provider, KPIs[kpiIndex].dateRequestStart)

      const prevKPI = KPIs[kpiIndex - 1]
      let percentInBP = KPIs[kpiIndex].percentInBP
      if (!prevKPI.isFullRefund) {
        percentInBP = percentInBP - prevKPI.percentInBP
      }

      await IDOToken.transfer(vesting.address, userAmountInIDOToken)

      // User asks for refund on KPI 2
      let claimedTokens = await IDOToken.balanceOf(user.address)
      totalClaimedInIDOToken = totalClaimedInIDOToken.add(claimedTokens)

      const expectedRefund2 = userAmountInIDOToken.mul(percentInBP).div(bpPrecision)
      await IDOToken.connect(user).approve(refund.address, expectedRefund2)

      await expect(refund.connect(user).requestRefund(IDOToken.address, ido.address, 0, kpiIndex, zeroData))
        .to.emit(refund, 'RequestRefund')
        .withArgs(IDOToken.address, ido.address, user.address, expectedRefund2, 0, kpiIndex)
      totalRefundRequestedInToken = totalRefundRequestedInToken.add(expectedRefund2)

      expect(await IDOToken.balanceOf(user.address)).to.eq(0)

      // Check info
      let refundInfo = await refund.infoOf(IDOToken.address, ido.address, user.address)
      expect(refundInfo.accountInfoOf.refundRequestedInToken).to.eq(totalRefundRequestedInToken)
      expect(refundInfo.accountInfoOf.refundRequestedWithMultiplierInToken).to.eq(totalRefundRequestedInToken)
      expect(refundInfo.accountInfoOf.claimedRefundRequestedInToken).to.eq(0)
      expect(refundInfo.accountInfoOf.refundRequestedByKPIInToken[kpiIndex]).to.eq(expectedRefund2)

      // Try to claim tokens
      let vestingInfo = await vesting.infoOf(IDOToken.address, ido.address, user.address)
      expect(vestingInfo.refundInfo.total).to.eq(userAmountInIDOToken)
      expect(vestingInfo.refundInfo.totalClaimed).to.eq(totalClaimedInIDOToken)
      expect(vestingInfo.refundInfo.withdrawableAmount).to.eq(0)

      await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address)).to.be.revertedWith('BRV:Z')

      // Claim 3 and 4 KPIs without refund
      for (kpiIndex = 2; kpiIndex <= 3; ++kpiIndex) {
        await mineBlockAtTime(ethers.provider, KPIs[kpiIndex].dateRequestStart)

        // User claim tokens
        await vesting.connect(user).withdraw(IDOToken.address, ido.address)
        claimedTokens = await IDOToken.balanceOf(user.address)
        totalClaimedInIDOToken = claimedTokens

        refundInfo = await refund.infoOf(IDOToken.address, ido.address, user.address)
        expect(refundInfo.accountInfoOf.refundRequestedInToken).to.eq(totalRefundRequestedInToken)
        expect(refundInfo.accountInfoOf.refundRequestedWithMultiplierInToken).to.eq(totalRefundRequestedInToken)
        expect(refundInfo.accountInfoOf.claimedRefundRequestedInToken).to.eq(0)
        expect(refundInfo.accountInfoOf.refundRequestedByKPIInToken[kpiIndex]).to.eq(0)

        vestingInfo = await vesting.infoOf(IDOToken.address, ido.address, user.address)
        expect(vestingInfo.refundInfo.total).to.eq(userAmountInIDOToken)
        expect(vestingInfo.refundInfo.totalClaimed).to.eq(totalClaimedInIDOToken)
        expect(vestingInfo.refundInfo.withdrawableAmount).to.eq(0)

        await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address)).to.be.revertedWith('BRV:Z')
      }

      // Refund 4 KPI
      kpiIndex = 3
      percentInBP = KPIs[kpiIndex].percentInBP - KPIs[kpiIndex - 1].percentInBP
      const expectedRefund4 = userAmountInIDOToken.mul(percentInBP).div(bpPrecision)
      await IDOToken.connect(user).approve(refund.address, expectedRefund4)

      await expect(
        refund.connect(user).requestRefund(IDOToken.address, ido.address, expectedRefund4, kpiIndex, zeroData)
      )
        .to.emit(refund, 'RequestRefund')
        .withArgs(IDOToken.address, ido.address, user.address, expectedRefund4, expectedRefund4, kpiIndex)

      totalRefundRequestedInToken = totalRefundRequestedInToken.add(expectedRefund4)
      // Tokens for the 3rd KPI
      const tokensFor3KPI = userAmountInIDOToken.mul(KPIs[2].percentInBP - KPIs[1].percentInBP).div(bpPrecision)
      expect(await IDOToken.balanceOf(user.address)).to.eq(tokensFor3KPI)

      // Check info
      refundInfo = await refund.infoOf(IDOToken.address, ido.address, user.address)
      expect(refundInfo.accountInfoOf.refundRequestedInToken).to.eq(totalRefundRequestedInToken)
      expect(refundInfo.accountInfoOf.refundRequestedWithMultiplierInToken).to.eq(totalRefundRequestedInToken)
      expect(refundInfo.accountInfoOf.claimedRefundRequestedInToken).to.eq(expectedRefund4)
      expect(refundInfo.accountInfoOf.refundRequestedByKPIInToken[kpiIndex]).to.eq(expectedRefund4)

      // Vesting info
      vestingInfo = await vesting.infoOf(IDOToken.address, ido.address, user.address)
      expect(vestingInfo.refundInfo.total).to.eq(userAmountInIDOToken)
      expect(vestingInfo.refundInfo.totalClaimed).to.eq(totalClaimedInIDOToken)
      expect(vestingInfo.refundInfo.withdrawableAmount).to.eq(0)
    })

    it('requestRefund:no claim each KPI:refund each KPI except 1', async () => {
      let totalRefundRequestedInToken = BigNumber.from(0)
      for (let kpiIndex = 1; kpiIndex < KPIs.length; ++kpiIndex) {
        await mineBlockAtTime(ethers.provider, KPIs[kpiIndex].dateRequestStart)

        const claimedTokens = await IDOToken.balanceOf(user.address)

        const prevKPI = KPIs[kpiIndex - 1]
        const percentInBP = KPIs[kpiIndex].percentInBP - prevKPI.percentInBP

        const expectedRefund = userAmountInIDOToken.mul(percentInBP).div(bpPrecision)

        await expect(refund.connect(user).requestRefund(IDOToken.address, ido.address, 0, kpiIndex, zeroData))
          .to.emit(refund, 'RequestRefund')
          .withArgs(IDOToken.address, ido.address, user.address, expectedRefund, 0, kpiIndex)
        totalRefundRequestedInToken = totalRefundRequestedInToken.add(expectedRefund)

        expect(await IDOToken.balanceOf(user.address)).to.eq(claimedTokens)

        // Check info
        const refundInfo = await refund.infoOf(IDOToken.address, ido.address, user.address)
        expect(refundInfo.accountInfoOf.refundRequestedInToken).to.eq(totalRefundRequestedInToken)
        expect(refundInfo.accountInfoOf.refundRequestedWithMultiplierInToken).to.eq(totalRefundRequestedInToken)
        expect(refundInfo.accountInfoOf.claimedRefundRequestedInToken).to.eq(0)
        expect(refundInfo.accountInfoOf.refundRequestedByKPIInToken[kpiIndex]).to.eq(expectedRefund)

        // Vesting info
        const vestingInfo = await vesting.infoOf(IDOToken.address, ido.address, user.address)
        expect(vestingInfo.refundInfo.total).to.eq(userAmountInIDOToken)
        expect(vestingInfo.refundInfo.totalClaimed).to.eq(claimedTokens)
        expect(vestingInfo.refundInfo.withdrawableAmount).to.eq(0)

        await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address)).to.be.revertedWith('BRV:Z')
      }
    })

    it('requestRefund:claim each KPI:refund each KPI except 1', async () => {
      await IDOToken.transfer(vesting.address, userAmountInIDOToken)
      await mineBlockAtTime(ethers.provider, KPIs[0].dateRequestStart)

      await vesting.connect(user).withdraw(IDOToken.address, ido.address)

      let totalRefundRequestedInToken = BigNumber.from(0)

      for (let kpiIndex = 1; kpiIndex < KPIs.length; ++kpiIndex) {
        await mineBlockAtTime(ethers.provider, KPIs[kpiIndex].dateRequestStart)

        const prevKPI = KPIs[kpiIndex - 1]
        let percentInBP = KPIs[kpiIndex].percentInBP
        if (!prevKPI.isFullRefund) {
          percentInBP = KPIs[kpiIndex].percentInBP - prevKPI.percentInBP
        }

        const expectedRefund = userAmountInIDOToken.mul(percentInBP).div(bpPrecision)

        await vesting.connect(user).withdraw(IDOToken.address, ido.address)
        const claimedTokens = await IDOToken.balanceOf(user.address)
        const userBringAmountInToken = claimedTokens

        await IDOToken.connect(user).approve(refund.address, userBringAmountInToken)

        await expect(
          refund.connect(user).requestRefund(IDOToken.address, ido.address, userBringAmountInToken, kpiIndex, zeroData)
        )
          .to.emit(refund, 'RequestRefund')
          .withArgs(IDOToken.address, ido.address, user.address, expectedRefund, userBringAmountInToken, kpiIndex)
        totalRefundRequestedInToken = totalRefundRequestedInToken.add(expectedRefund)

        expect(await IDOToken.balanceOf(user.address)).to.eq(0)

        // Check info
        const refundInfo = await refund.infoOf(IDOToken.address, ido.address, user.address)
        expect(refundInfo.accountInfoOf.refundRequestedInToken).to.eq(totalRefundRequestedInToken)
        expect(refundInfo.accountInfoOf.refundRequestedWithMultiplierInToken).to.eq(totalRefundRequestedInToken)
        expect(refundInfo.accountInfoOf.claimedRefundRequestedInToken).to.eq(totalRefundRequestedInToken)
        expect(refundInfo.accountInfoOf.refundRequestedByKPIInToken[kpiIndex]).to.eq(expectedRefund)

        // Vesting info
        const vestingInfo = await vesting.infoOf(IDOToken.address, ido.address, user.address)
        expect(vestingInfo.refundInfo.total).to.eq(userAmountInIDOToken)
        expect(vestingInfo.refundInfo.totalClaimed).to.eq(totalRefundRequestedInToken)
        expect(vestingInfo.refundInfo.withdrawableAmount).to.eq(0)

        await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address)).to.be.revertedWith('BRV:Z')
      }
    })

    describe('requestRefund:full refund:burn referral shares', () => {
      let otherUserAmountInIDOToken: BigNumber

      beforeEach(async () => {
        // Other user buy with same referrer
        otherUserAmountInIDOToken = expandTo18Decimals(50)
        await ido.addAccount(user2.address, otherUserAmountInIDOToken, referrer.address, defaultReferrer.address)

        await mineBlockAtTime(ethers.provider, KPIs[0].dateRequestStart)
      })

      it('1 parent:1 default address', async () => {
        // User has 1 parent - referrer
        expect(await referralPool.sharesOf(referrer.address)).to.eq(userAmountInIDOToken.add(otherUserAmountInIDOToken))
        expect(await referralPool.sharesOf(defaultReferrer.address)).to.eq(
          userAmountInIDOToken.add(otherUserAmountInIDOToken)
        )

        // User asks for full refund
        await refund.connect(user).requestRefund(IDOToken.address, ido.address, 0, 0, zeroData)

        // Check parents
        expect(await referralPool.sharesOf(referrer.address)).to.eq(otherUserAmountInIDOToken)
        expect(await referralPool.sharesOf(defaultReferrer.address)).to.eq(otherUserAmountInIDOToken)
      })

      it('2 parents:1 default address', async () => {
        await ido.addAccount(user.address, userAmountInIDOToken, referrer.address, referrer2.address)

        // User has 2 parents and default referrer (he bought 2 times)
        expect(await referralPool.sharesOf(referrer.address)).to.eq(
          userAmountInIDOToken.mul(2).add(otherUserAmountInIDOToken)
        )
        expect(await referralPool.sharesOf(referrer2.address)).to.eq(userAmountInIDOToken)
        expect(await referralPool.sharesOf(defaultReferrer.address)).to.eq(
          userAmountInIDOToken.add(otherUserAmountInIDOToken)
        )

        // User asks for full refund
        await refund.connect(user).requestRefund(IDOToken.address, ido.address, 0, 0, zeroData)

        // Check parents
        expect(await referralPool.sharesOf(referrer.address)).to.eq(otherUserAmountInIDOToken)
        expect(await referralPool.sharesOf(referrer2.address)).to.eq(0)
        expect(await referralPool.sharesOf(defaultReferrer.address)).to.eq(otherUserAmountInIDOToken)
      })

      it('in 2 tx', async () => {
        // User has 1 parent - referrer
        expect(await referralPool.sharesOf(referrer.address)).to.eq(userAmountInIDOToken.add(otherUserAmountInIDOToken))
        expect(await referralPool.sharesOf(defaultReferrer.address)).to.eq(
          userAmountInIDOToken.add(otherUserAmountInIDOToken)
        )

        // User withdraw 1 KPI tokens
        await IDOToken.transfer(vesting.address, userAmountInIDOToken)
        await vesting.connect(user).withdraw(IDOToken.address, ido.address)

        // User asks for refund
        await refund.connect(user).requestRefund(IDOToken.address, ido.address, 0, 0, zeroData)

        // Check parents
        expect(await referralPool.sharesOf(referrer.address)).to.eq(otherUserAmountInIDOToken)
        expect(await referralPool.sharesOf(defaultReferrer.address)).to.eq(otherUserAmountInIDOToken)

        // User asks for claimed tokens refund
        const claimedTokens = await IDOToken.balanceOf(user.address)
        await IDOToken.connect(user).approve(refund.address, claimedTokens)
        await refund.connect(user).requestRefund(IDOToken.address, ido.address, claimedTokens, 0, zeroData)

        // Check parents
        expect(await referralPool.sharesOf(referrer.address)).to.eq(otherUserAmountInIDOToken)
        expect(await referralPool.sharesOf(defaultReferrer.address)).to.eq(otherUserAmountInIDOToken)
      })

      it('claim 2 KPI', async () => {
        // User has 1 parent - referrer
        expect(await referralPool.sharesOf(referrer.address)).to.eq(userAmountInIDOToken.add(otherUserAmountInIDOToken))
        expect(await referralPool.sharesOf(defaultReferrer.address)).to.eq(
          userAmountInIDOToken.add(otherUserAmountInIDOToken)
        )
        // User request refund in 2 KPI
        await mineBlockAtTime(ethers.provider, KPIs[1].dateRequestStart)
        await refund.connect(user).requestRefund(IDOToken.address, ido.address, 0, 1, zeroData)

        // Check parents (shares the same)
        expect(await referralPool.sharesOf(referrer.address)).to.eq(userAmountInIDOToken.add(otherUserAmountInIDOToken))
        expect(await referralPool.sharesOf(defaultReferrer.address)).to.eq(
          userAmountInIDOToken.add(otherUserAmountInIDOToken)
        )
      })
    })

    describe('1st KPI non-zero', () => {
      beforeEach(async () => {
        const kpiIndex = 0
        KPIs[kpiIndex] = {
          dateRequestStart: tgeDate,
          dateRequestEnd: tgeDate + days(1),
          percentInBP: vestingPercentage,
          multiplierInBP: bpPrecision,
          isFullRefund: true,
          isRefundable: true
        }

        await refund.setKPI(IDOToken.address, ido.address, kpiIndex, KPIs[kpiIndex])
      })

      it('requestRefund:refund not full refund KPIs:claim in 1 tx', async () => {
        await IDOToken.transfer(vesting.address, userAmountInIDOToken)

        await mineBlockAtTime(ethers.provider, KPIs[0].dateRequestStart)
        await vesting.connect(user).withdraw(IDOToken.address, ido.address)

        const userBalanceInToken = await IDOToken.balanceOf(user.address)
        let totalUserAmountInIDOToken = BigNumber.from(0)
        let totalClaimedInIDOToken = userBalanceInToken

        for (let kpiIndex = 1; kpiIndex < KPIs.length; kpiIndex++) {
          const prevKPI = KPIs[kpiIndex - 1]
          const percentInBP = KPIs[kpiIndex].percentInBP - prevKPI.percentInBP

          const amountInIDOToken = userAmountInIDOToken.mul(percentInBP).div(bpPrecision)
          await mineBlockAtTime(ethers.provider, KPIs[kpiIndex].dateRequestStart)
          // User claim tokens
          await vesting.connect(user).withdraw(IDOToken.address, ido.address)
          totalClaimedInIDOToken = totalClaimedInIDOToken.add(amountInIDOToken)

          // User asks for refund
          await IDOToken.connect(user).approve(refund.address, amountInIDOToken)

          await expect(
            refund.connect(user).requestRefund(IDOToken.address, ido.address, amountInIDOToken, kpiIndex, zeroData)
          )
            .to.emit(refund, 'RequestRefund')
            .withArgs(IDOToken.address, ido.address, user.address, amountInIDOToken, amountInIDOToken, kpiIndex)
          totalUserAmountInIDOToken = totalUserAmountInIDOToken.add(amountInIDOToken)

          expect(await IDOToken.balanceOf(user.address)).to.eq(userBalanceInToken)

          // Check info
          const refundInfo = await refund.infoOf(IDOToken.address, ido.address, user.address)
          expect(refundInfo.accountInfoOf.refundRequestedInToken).to.eq(totalUserAmountInIDOToken)
          expect(refundInfo.accountInfoOf.refundRequestedWithMultiplierInToken).to.eq(totalUserAmountInIDOToken)
          expect(refundInfo.accountInfoOf.claimedRefundRequestedInToken).to.eq(totalUserAmountInIDOToken)
          expect(refundInfo.accountInfoOf.refundRequestedByKPIInToken[kpiIndex]).to.eq(amountInIDOToken)

          // Try to claim tokens
          const vestingInfo = await vesting.infoOf(IDOToken.address, ido.address, user.address)
          expect(vestingInfo.refundInfo.total).to.eq(userAmountInIDOToken)
          expect(vestingInfo.refundInfo.totalClaimed).to.eq(totalClaimedInIDOToken)
          expect(vestingInfo.refundInfo.withdrawableAmount).to.eq(0)

          await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address)).to.be.revertedWith('BRV:Z')
        }
      })

      it('requestRefund:refund 2 KPI no claim:claim 3 and 4 KPIs:refund 4 KPI', async () => {
        let totalClaimedInIDOToken = BigNumber.from(0)
        let totalRefundRequestedInToken = BigNumber.from(0)

        let kpiIndex = 1
        await mineBlockAtTime(ethers.provider, KPIs[kpiIndex].dateRequestStart)

        const prevKPI = KPIs[kpiIndex - 1]
        let percentInBP = KPIs[kpiIndex].percentInBP - prevKPI.percentInBP

        const tokensFor1KPI = userAmountInIDOToken.mul(percentInBP).div(bpPrecision)

        await IDOToken.transfer(vesting.address, userAmountInIDOToken)

        // User asks for refund on KPI 2
        let claimedTokens = await IDOToken.balanceOf(user.address)
        totalClaimedInIDOToken = totalClaimedInIDOToken.add(claimedTokens)

        const expectedRefund2 = userAmountInIDOToken.mul(percentInBP).div(bpPrecision)
        await IDOToken.connect(user).approve(refund.address, expectedRefund2)

        await expect(refund.connect(user).requestRefund(IDOToken.address, ido.address, 0, kpiIndex, zeroData))
          .to.emit(refund, 'RequestRefund')
          .withArgs(IDOToken.address, ido.address, user.address, expectedRefund2, 0, kpiIndex)
        totalRefundRequestedInToken = totalRefundRequestedInToken.add(expectedRefund2)

        expect(await IDOToken.balanceOf(user.address)).to.eq(0)

        // Check info
        let refundInfo = await refund.infoOf(IDOToken.address, ido.address, user.address)
        expect(refundInfo.accountInfoOf.refundRequestedInToken).to.eq(totalRefundRequestedInToken)
        expect(refundInfo.accountInfoOf.refundRequestedWithMultiplierInToken).to.eq(totalRefundRequestedInToken)
        expect(refundInfo.accountInfoOf.claimedRefundRequestedInToken).to.eq(0)
        expect(refundInfo.accountInfoOf.refundRequestedByKPIInToken[kpiIndex]).to.eq(expectedRefund2)

        // Try to claim tokens
        let vestingInfo = await vesting.infoOf(IDOToken.address, ido.address, user.address)
        expect(vestingInfo.refundInfo.total).to.eq(userAmountInIDOToken)
        expect(vestingInfo.refundInfo.totalClaimed).to.eq(totalClaimedInIDOToken)
        expect(vestingInfo.refundInfo.withdrawableAmount).to.eq(tokensFor1KPI)

        await vesting.connect(user).withdraw(IDOToken.address, ido.address)

        // Claim 3 and 4 KPIs without refund
        for (kpiIndex = 2; kpiIndex <= 3; ++kpiIndex) {
          await mineBlockAtTime(ethers.provider, KPIs[kpiIndex].dateRequestStart)

          // User claim tokens
          await vesting.connect(user).withdraw(IDOToken.address, ido.address)
          claimedTokens = await IDOToken.balanceOf(user.address)
          totalClaimedInIDOToken = claimedTokens

          refundInfo = await refund.infoOf(IDOToken.address, ido.address, user.address)
          expect(refundInfo.accountInfoOf.refundRequestedInToken).to.eq(totalRefundRequestedInToken)
          expect(refundInfo.accountInfoOf.refundRequestedWithMultiplierInToken).to.eq(totalRefundRequestedInToken)
          expect(refundInfo.accountInfoOf.claimedRefundRequestedInToken).to.eq(0)
          expect(refundInfo.accountInfoOf.refundRequestedByKPIInToken[kpiIndex]).to.eq(0)

          vestingInfo = await vesting.infoOf(IDOToken.address, ido.address, user.address)
          expect(vestingInfo.refundInfo.total).to.eq(userAmountInIDOToken)
          expect(vestingInfo.refundInfo.totalClaimed).to.eq(totalClaimedInIDOToken)
          expect(vestingInfo.refundInfo.withdrawableAmount).to.eq(0)

          await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address)).to.be.revertedWith('BRV:Z')
        }

        // Refund 4 KPI
        kpiIndex = 3
        percentInBP = KPIs[kpiIndex].percentInBP - KPIs[kpiIndex - 1].percentInBP
        const expectedRefund4 = userAmountInIDOToken.mul(percentInBP).div(bpPrecision)
        await IDOToken.connect(user).approve(refund.address, expectedRefund4)

        await expect(
          refund.connect(user).requestRefund(IDOToken.address, ido.address, expectedRefund4, kpiIndex, zeroData)
        )
          .to.emit(refund, 'RequestRefund')
          .withArgs(IDOToken.address, ido.address, user.address, expectedRefund4, expectedRefund4, kpiIndex)

        totalRefundRequestedInToken = totalRefundRequestedInToken.add(expectedRefund4)
        // Tokens for the 3rd KPI
        const tokensFor3KPI = userAmountInIDOToken.mul(KPIs[2].percentInBP - KPIs[1].percentInBP).div(bpPrecision)
        expect(await IDOToken.balanceOf(user.address)).to.eq(tokensFor3KPI.add(tokensFor1KPI))

        // Check info
        refundInfo = await refund.infoOf(IDOToken.address, ido.address, user.address)
        expect(refundInfo.accountInfoOf.refundRequestedInToken).to.eq(totalRefundRequestedInToken)
        expect(refundInfo.accountInfoOf.refundRequestedWithMultiplierInToken).to.eq(totalRefundRequestedInToken)
        expect(refundInfo.accountInfoOf.claimedRefundRequestedInToken).to.eq(expectedRefund4)
        expect(refundInfo.accountInfoOf.refundRequestedByKPIInToken[kpiIndex]).to.eq(expectedRefund4)

        // Vesting info
        vestingInfo = await vesting.infoOf(IDOToken.address, ido.address, user.address)
        expect(vestingInfo.refundInfo.total).to.eq(userAmountInIDOToken)
        expect(vestingInfo.refundInfo.totalClaimed).to.eq(totalClaimedInIDOToken)
        expect(vestingInfo.refundInfo.withdrawableAmount).to.eq(0)
      })
    })

    describe('requestRefund:refund with multiplier', () => {
      let userAmountInIDOTokenWithMultiplier: BigNumber
      beforeEach(async () => {
        const multiplierInBP = 9_000 // 90%
        KPIs = [
          {
            dateRequestStart: tgeDate,
            dateRequestEnd: tgeDate + days(1),
            percentInBP: 0,
            multiplierInBP: bpPrecision,
            isFullRefund: true,
            isRefundable: true
          },
          {
            dateRequestStart: vestingDates[0],
            dateRequestEnd: vestingDates[0] + days(1),
            percentInBP: vestingPercentage * 2,
            multiplierInBP: multiplierInBP,
            isFullRefund: false,
            isRefundable: true
          },
          {
            dateRequestStart: vestingDates[1],
            dateRequestEnd: vestingDates[1] + days(1),
            percentInBP: vestingPercentage * 3,
            multiplierInBP: multiplierInBP,
            isFullRefund: false,
            isRefundable: true
          },
          {
            dateRequestStart: vestingDates[2],
            dateRequestEnd: vestingDates[2] + days(1),
            percentInBP: bpPrecision,
            multiplierInBP: multiplierInBP,
            isFullRefund: false,
            isRefundable: true
          }
        ]

        for (let i = 0; i < KPIs.length; i++) {
          await refund.setKPI(IDOToken.address, ido.address, i, KPIs[i])
        }

        userAmountInIDOTokenWithMultiplier = userAmountInIDOToken.mul(multiplierInBP).div(bpPrecision)
      })

      it('requestRefund:full refund with multiplier:1 claim', async () => {
        await mineBlockAtTime(ethers.provider, KPIs[0].dateRequestStart)
        await IDOToken.transfer(vesting.address, userAmountInIDOToken)

        // User claim tokens
        await vesting.connect(user).withdraw(IDOToken.address, ido.address)

        // User asks for refund
        const userBalanceInToken = await IDOToken.balanceOf(user.address)
        await IDOToken.connect(user).approve(refund.address, userBalanceInToken)

        await expect(refund.connect(user).requestRefund(IDOToken.address, ido.address, userBalanceInToken, 0, zeroData))
          .to.emit(refund, 'RequestRefund')
          .withArgs(IDOToken.address, ido.address, user.address, userAmountInIDOToken, userBalanceInToken, 0)

        expect(await IDOToken.balanceOf(user.address)).to.eq(0)

        // Check info
        const refundInfo = await refund.infoOf(IDOToken.address, ido.address, user.address)
        expect(refundInfo.accountInfoOf.refundRequestedInToken).to.eq(userAmountInIDOToken)
        expect(refundInfo.accountInfoOf.refundRequestedWithMultiplierInToken).to.eq(userAmountInIDOToken)
        expect(refundInfo.accountInfoOf.claimedRefundRequestedInToken).to.eq(userBalanceInToken)
        expect(refundInfo.accountInfoOf.refundRequestedByKPIInToken[0]).to.eq(userAmountInIDOToken)

        // Try to claim tokens
        const vestingInfo = await vesting.infoOf(IDOToken.address, ido.address, user.address)
        expect(vestingInfo.refundInfo.total).to.eq(userAmountInIDOToken)
        expect(vestingInfo.refundInfo.totalClaimed).to.eq(userBalanceInToken)
        expect(vestingInfo.refundInfo.withdrawableAmount).to.eq(0)

        await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address)).to.be.revertedWith('BRV:Z')
      })

      it('requestRefund:refund with multiplier:1 claim', async () => {
        const kpiIndex = 2
        await mineBlockAtTime(ethers.provider, KPIs[kpiIndex].dateRequestStart)
        await IDOToken.transfer(vesting.address, userAmountInIDOTokenWithMultiplier)

        // User claim tokens
        await vesting.connect(user).withdraw(IDOToken.address, ido.address)

        // User asks for refund
        const prevKPI = KPIs[kpiIndex - 1]
        const percentInBP = KPIs[kpiIndex].percentInBP - prevKPI.percentInBP

        const amountInIDOToken = userAmountInIDOToken.mul(percentInBP).div(bpPrecision)
        const amountWithMultiplierInIDOToken = amountInIDOToken.mul(KPIs[kpiIndex].multiplierInBP).div(bpPrecision)
        const userBalanceInToken = await IDOToken.balanceOf(user.address)
        await IDOToken.connect(user).approve(refund.address, userBalanceInToken)
        const userBalanceAfterRefundInToken = userBalanceInToken.sub(amountInIDOToken)

        await expect(
          refund.connect(user).requestRefund(IDOToken.address, ido.address, amountInIDOToken, kpiIndex, zeroData)
        )
          .to.emit(refund, 'RequestRefund')
          .withArgs(IDOToken.address, ido.address, user.address, amountInIDOToken, amountInIDOToken, kpiIndex)

        expect(await IDOToken.balanceOf(user.address)).to.eq(userBalanceAfterRefundInToken)

        // Check info
        const refundInfo = await refund.infoOf(IDOToken.address, ido.address, user.address)
        expect(refundInfo.accountInfoOf.refundRequestedInToken).to.eq(amountInIDOToken)
        expect(refundInfo.accountInfoOf.refundRequestedWithMultiplierInToken).to.eq(amountWithMultiplierInIDOToken)
        expect(refundInfo.accountInfoOf.claimedRefundRequestedInToken).to.eq(amountInIDOToken)
        expect(refundInfo.accountInfoOf.refundRequestedByKPIInToken[kpiIndex]).to.eq(amountInIDOToken)

        // Try to claim tokens
        const vestingInfo = await vesting.infoOf(IDOToken.address, ido.address, user.address)
        expect(vestingInfo.refundInfo.total).to.eq(userAmountInIDOToken)
        expect(vestingInfo.refundInfo.totalClaimed).to.eq(userBalanceInToken)
        expect(vestingInfo.refundInfo.withdrawableAmount).to.eq(0)

        await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address)).to.be.revertedWith('BRV:Z')
      })

      it('requestRefund:full refund with multiplier:no claim', async () => {
        await mineBlockAtTime(ethers.provider, KPIs[0].dateRequestStart)

        const userBalanceInToken = await IDOToken.balanceOf(user.address)

        await expect(refund.connect(user).requestRefund(IDOToken.address, ido.address, 0, 0, zeroData))
          .to.emit(refund, 'RequestRefund')
          .withArgs(IDOToken.address, ido.address, user.address, userAmountInIDOToken, 0, 0)

        expect(await IDOToken.balanceOf(user.address)).to.eq(userBalanceInToken)

        // Check info
        const refundInfo = await refund.infoOf(IDOToken.address, ido.address, user.address)
        expect(refundInfo.accountInfoOf.refundRequestedInToken).to.eq(userAmountInIDOToken)
        expect(refundInfo.accountInfoOf.refundRequestedWithMultiplierInToken).to.eq(userAmountInIDOToken)
        expect(refundInfo.accountInfoOf.claimedRefundRequestedInToken).to.eq(0)
        expect(refundInfo.accountInfoOf.refundRequestedByKPIInToken[0]).to.eq(userAmountInIDOToken)

        // Try to claim tokens
        const vestingInfo = await vesting.infoOf(IDOToken.address, ido.address, user.address)
        expect(vestingInfo.refundInfo.total).to.eq(userAmountInIDOToken)
        expect(vestingInfo.refundInfo.totalClaimed).to.eq(0)
        expect(vestingInfo.refundInfo.withdrawableAmount).to.eq(0)

        await expect(vesting.connect(user).withdraw(IDOToken.address, ido.address)).to.be.revertedWith('BRV:Z')
      })

      it('requestRefund:refund with multiplier:no claim', async () => {
        const kpiIndex = 2
        await mineBlockAtTime(ethers.provider, KPIs[kpiIndex].dateRequestStart)

        const userBalanceInToken = await IDOToken.balanceOf(user.address)

        const prevKPI = KPIs[kpiIndex - 1]
        const percentInBP = KPIs[kpiIndex].percentInBP - prevKPI.percentInBP
        const withdrawableAmount = userAmountInIDOToken.mul(KPIs[kpiIndex].percentInBP - percentInBP).div(bpPrecision)

        const amountInIDOToken = userAmountInIDOToken.mul(percentInBP).div(bpPrecision)
        const amountWithMultiplierInIDOToken = amountInIDOToken.mul(KPIs[kpiIndex].multiplierInBP).div(bpPrecision)

        await expect(refund.connect(user).requestRefund(IDOToken.address, ido.address, 0, kpiIndex, zeroData))
          .to.emit(refund, 'RequestRefund')
          .withArgs(IDOToken.address, ido.address, user.address, amountInIDOToken, 0, kpiIndex)

        expect(await IDOToken.balanceOf(user.address)).to.eq(userBalanceInToken)

        // Check info
        const refundInfo = await refund.infoOf(IDOToken.address, ido.address, user.address)
        expect(refundInfo.accountInfoOf.refundRequestedInToken).to.eq(amountInIDOToken)
        expect(refundInfo.accountInfoOf.refundRequestedWithMultiplierInToken).to.eq(amountWithMultiplierInIDOToken)
        expect(refundInfo.accountInfoOf.claimedRefundRequestedInToken).to.eq(0)
        expect(refundInfo.accountInfoOf.refundRequestedByKPIInToken[kpiIndex]).to.eq(amountInIDOToken)

        // Try to claim tokens
        const vestingInfo = await vesting.infoOf(IDOToken.address, ido.address, user.address)
        expect(vestingInfo.refundInfo.total).to.eq(userAmountInIDOToken)
        expect(vestingInfo.refundInfo.totalClaimed).to.eq(0)
        expect(vestingInfo.refundInfo.withdrawableAmount).to.eq(withdrawableAmount)
      })
    })
  })
})
