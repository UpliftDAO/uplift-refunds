import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address'
import { expect } from 'chai'
import { ethers } from 'hardhat'
import {
  ERC1967Proxy,
  ERC1967Proxy__factory,
  Registry,
  Registry__factory,
  TestBaseRefundClaimer,
  TestBaseRefundClaimer__factory,
  UpgradedTestBaseRefundClaimer,
  UpgradedTestBaseRefundClaimer__factory
} from '../typechain'
import { expandTo18Decimals } from '../utils/utilities'
import { TestERC20__factory } from './../typechain/factories/TestERC20__factory'
import { TestRefundIDO__factory } from './../typechain/factories/TestRefundIDO__factory'
import { TestERC20 } from './../typechain/TestERC20.d'
import { TestRefundIDO } from './../typechain/TestRefundIDO.d'

describe('BaseRefundClaimer', () => {
  let owner: SignerWithAddress
  let user: SignerWithAddress

  let registry: Registry

  let claimer: TestBaseRefundClaimer
  let proxy: ERC1967Proxy
  let IDOToken: TestERC20
  let ido: TestRefundIDO

  beforeEach(async () => {
    ;[owner, user] = await ethers.getSigners()

    registry = await new Registry__factory(owner).deploy(owner.address)
    IDOToken = await new TestERC20__factory(owner).deploy('IDO Token', 'IDO_TKN', expandTo18Decimals(1_000_000))
    ido = await new TestRefundIDO__factory(owner).deploy()

    // Deploy claimer
    claimer = await new TestBaseRefundClaimer__factory(owner).deploy()

    proxy = await new ERC1967Proxy__factory(owner).deploy(
      claimer.address,
      claimer.interface.encodeFunctionData('initialize', [
        registry.address,
        IDOToken.address,
        ido.address,
        ethers.utils.defaultAbiCoder.encode([], [])
      ])
    )
    claimer = claimer.attach(proxy.address)
  })

  describe('upgradeability', () => {
    let updatedVesting: UpgradedTestBaseRefundClaimer

    beforeEach(async () => {
      updatedVesting = await new UpgradedTestBaseRefundClaimer__factory(owner).deploy()
    })

    it('upgrade:successfully', async () => {
      await claimer.upgradeTo(updatedVesting.address)
      expect(await updatedVesting.attach(proxy.address).test()).to.eq('Success')
    })

    it('upgrade:forbidden', async () => {
      await expect(claimer.connect(user).upgradeTo(updatedVesting.address)).to.revertedWith('BRC:F')
    })

    it('upgrade:wrong interface', async () => {
      await expect(claimer.upgradeTo(ido.address)).to.revertedWith('BRC:I')
    })
  })
})
