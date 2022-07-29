import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address'
import { expect } from 'chai'
import { ethers } from 'hardhat'
import {
  ERC1967Proxy,
  ERC1967Proxy__factory,
  Registry,
  Registry__factory,
  TestBaseRefundVesting,
  TestBaseRefundVesting__factory,
  TestERC20,
  TestERC20__factory,
  TestRefundIDO,
  TestRefundIDO__factory,
  TestRefundRequester,
  TestRefundRequester__factory,
  UpgradedTestBaseRefundVesting,
  UpgradedTestBaseRefundVesting__factory
} from '../typechain'
import { expandTo18Decimals } from '../utils/utilities'

describe('BaseRefundVesting', () => {
  let owner: SignerWithAddress
  let user: SignerWithAddress

  let registry: Registry
  let IDOToken: TestERC20
  let ido: TestRefundIDO
  let refund: TestRefundRequester
  let vesting: TestBaseRefundVesting
  let proxy: ERC1967Proxy

  type InitializeInfo = {
    token: string
    identifier: string
    refund: string
  }

  beforeEach(async () => {
    ;[owner, user] = await ethers.getSigners()

    registry = await new Registry__factory(owner).deploy(owner.address)
    IDOToken = await new TestERC20__factory(owner).deploy('IDO Token', 'IDO_TKN', expandTo18Decimals(1_000_000))

    // Mock IDO
    ido = await new TestRefundIDO__factory(owner).deploy()

    // Mock Refund
    refund = await new TestRefundRequester__factory(owner).deploy([], IDOToken.address)

    // Deploy vesting
    vesting = await new TestBaseRefundVesting__factory(owner).deploy()
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
        ethers.utils.defaultAbiCoder.encode([], [])
      ])
    )

    vesting = vesting.attach(proxy.address)
  })

  describe('upgradeability', () => {
    let updatedVesting: UpgradedTestBaseRefundVesting

    beforeEach(async () => {
      updatedVesting = await new UpgradedTestBaseRefundVesting__factory(owner).deploy()
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

    it('upgrade:wrong interface', async () => {
      await expect(vesting.upgradeTo(ido.address)).to.revertedWith('BRV:I')
    })
  })

  describe('initialization', () => {
    it('initialization', async () => {
      expect(await vesting.refundOf(IDOToken.address, ido.address)).to.eq(refund.address)
    })

    it('initialization:zero token', async () => {
      vesting = await new TestBaseRefundVesting__factory(owner).deploy()
      const initializeInfo: InitializeInfo = {
        token: ethers.constants.AddressZero,
        identifier: ido.address,
        refund: refund.address
      }

      await expect(
        new ERC1967Proxy__factory(owner).deploy(
          vesting.address,
          vesting.interface.encodeFunctionData('initialize', [
            registry.address,
            initializeInfo,
            ethers.utils.defaultAbiCoder.encode([], [])
          ])
        )
      ).to.be.revertedWith('BRV:Z')
    })
  })

  describe('setRefund', () => {
    it('setRefund:restricted', async () => {
      await expect(vesting.connect(user).setRefund(IDOToken.address, ido.address, user.address)).to.be.revertedWith(
        'BRC:F'
      )
    })

    it('setRefund:success', async () => {
      const newRefund = await new TestRefundRequester__factory(owner).deploy([], IDOToken.address)
      await expect(vesting.setRefund(IDOToken.address, ido.address, newRefund.address))
        .to.emit(vesting, 'SetRefund')
        .withArgs(IDOToken.address, ido.address, newRefund.address)
      expect(await vesting.refundOf(IDOToken.address, ido.address)).to.eq(newRefund.address)
    })

    it('setRefund:not IBaseRefundRequester', async () => {
      await expect(vesting.setRefund(IDOToken.address, ido.address, ido.address)).to.be.revertedWith('BRV:I')
    })
  })
})
