/* eslint-disable @typescript-eslint/no-unsafe-return */
'use strict'

import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address'
import { BigNumber, BigNumberish, Contract, ContractTransaction } from 'ethers'
import { solidityPack } from 'ethers/lib/utils'
import { ethers, web3 } from 'hardhat'
import yesno from 'yesno'
import { parseBool } from './parse'

const AbiCoder = ethers.utils.AbiCoder
const ADDRESS_PREFIX_REGEX = /^(41)/
const ADDRESS_PREFIX = '41'

export function expandTo18Decimals(n: number): BigNumber {
  return BigNumber.from(n).mul(BigNumber.from(10).pow(18))
}

export function logTitle(title: string): void {
  const formattedTitle = `*** ${title} ***`
  const border = Array(formattedTitle.length).fill('*').join('')
  console.log(`
${border}
${formattedTitle}
${border}
`)
}

export async function requestConfirmation(message = 'Ready to continue?'): Promise<void> {
  const ok = await yesno({
    yesValues: ['', 'yes', 'y', 'yes'],
    question: message
  })
  if (!ok) {
    throw new Error('Script cancelled.')
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function logAddress(address: string): void {
  console.log(`Address: \x1b[32m${address}\x1b[0m`)
}

export function logTxResult(txId: string): void {
  console.log(`Waiting for result of: \x1b[36m${txId}\x1b[0m`)
}

export async function deploy<T extends Contract>(name: string, promise: Promise<T>): Promise<T> {
  if (shouldRequestConfirmation()) {
    await requestConfirmation(`Would you like to deploy "${name}"?`)
  }
  console.log(`Deploying: "${name}"...`)
  const contract = await promise
  logAddress(contract.address)
  logTxResult(contract.deployTransaction.hash)
  await contract.deployTransaction.wait()
  console.log(`Successfully deployed: "${name}"`)
  return contract
}

export async function transaction(name: string, promise: Promise<ContractTransaction>): Promise<void> {
  if (shouldRequestConfirmation()) {
    await requestConfirmation(`Would you like to make transaction: "${name}"?`)
  }

  console.log(`Making transaction: "${name}"...`)
  const tx = await promise
  logTxResult(tx.hash)
  await tx.wait()
  console.log(`Successfully made transaction: "${name}"`)
}

function shouldRequestConfirmation(): boolean {
  const skipConfirmation = parseBool('SKIP_CONFIRMATION')
  return !skipConfirmation
}

export async function latestBlockTimestamp(provider: typeof ethers.provider): Promise<number> {
  const latestBlockNumber = await provider.getBlockNumber()
  const block = await provider.getBlock(latestBlockNumber)
  return block.timestamp
}

export async function impersonate(provider: typeof ethers.provider, address: string): Promise<SignerWithAddress> {
  await provider.send('hardhat_impersonateAccount', [address])
  return SignerWithAddress.create(ethers.provider.getSigner(address))
}

export async function mineBlocks(provider: typeof ethers.provider, count: number): Promise<void> {
  for (let i = 1; i < count; i++) {
    await provider.send('evm_mine', [])
  }
}

export function getUnixTimestamp(date: Date): number {
  return Math.floor(date.getTime() / 1000)
}

export async function mineBlockAtTime(provider: typeof ethers.provider, timestamp: number): Promise<void> {
  await provider.send('evm_mine', [timestamp])
}

export async function increaseTime(provider: typeof ethers.provider, timestamp: number): Promise<void> {
  await provider.send('evm_increaseTime', [timestamp])
}

export async function setAutomine(provider: typeof ethers.provider, automine: boolean): Promise<void> {
  await provider.send('evm_setAutomine', [automine])
}

export function formatJson(data: string): string {
  if (data[0] != '[') {
    const arr = '[' + data.replace(/\n$/, '').slice(0, -1) + ']' // We remove last character, because it was ,
    console.log(arr)
    return arr
  }
  return data
}

export const Q112 = BigNumber.from(2).pow(112)

export function toUQ112(value: BigNumberish): BigNumber {
  return BigNumber.from(value).mul(BigNumber.from(2).pow(112))
}

export function merkleHash(address: string, allocation: BigNumber): Buffer {
  const packed = solidityPack(['address', 'uint256'], [address, allocation])
  return Buffer.from(ethers.utils.arrayify(ethers.utils.keccak256(packed)))
}

export type TronDetails = { fullHost: string; solidityNode: string; eventServer: string }

export function tronDetails(network: string): TronDetails {
  switch (network) {
    case 'mainnetTron': {
      const mainNode = 'https://api.trongrid.io'
      return { fullHost: mainNode, solidityNode: mainNode, eventServer: mainNode }
    }
    default: {
      const testNode = 'https://api.shasta.trongrid.io'
      return { fullHost: testNode, solidityNode: testNode, eventServer: testNode }
    }
  }
}

export function tronAddressToValidETHAddress(tronWeb: any, address: string): string {
  return tronWeb.address.toHex(address).replace(ADDRESS_PREFIX_REGEX, '0x') as string
}

export type FunctionParams = { type: string; value: any }

export function decodeParams(types: any, output: any, ignoreMethodHash: any): Promise<any> {
  if (!output || typeof output === 'boolean') {
    ignoreMethodHash = output
    output = types
  }

  if (ignoreMethodHash && output.replace(/^0x/, '').length % 64 === 8)
    // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
    output = '0x' + output.replace(/^0x/, '').substring(8)

  const abiCoder = new AbiCoder()

  if (output.replace(/^0x/, '').length % 64)
    throw new Error('The encoded string is not valid. Its length must be a multiple of 64.')
  return abiCoder.decode(types, output).reduce((obj: any, arg: any, index: number) => {
    // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
    if (types[index] == 'address') arg = ADDRESS_PREFIX + arg.substr(2).toLowerCase()
    obj.push(arg)
    return obj
  }, [])
}

export async function callMethod(
  tronWeb: any,
  contractAddress: string,
  feeLimit: string,
  functionSelector: string,
  parameters: FunctionParams[] = []
): Promise<string> {
  const options = {
    feeLimit: feeLimit,
    callValue: 0
  }
  const issuerAddress = tronWeb.defaultAddress.base58
  const transactionObject = await tronWeb.transactionBuilder.triggerConstantContract(
    contractAddress,
    functionSelector,
    options,
    parameters,
    tronWeb.address.toHex(issuerAddress)
  )

  console.log('transactionObject ', functionSelector, transactionObject.constant_result)
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return transactionObject.constant_result[0]
}

export async function trySendTransaction(
  tronWeb: any,
  contractAddress: string,
  feeLimit: string,
  functionSelector: string,
  parameters: FunctionParams[] = [],
  callValue = 0 // In SUN, 1 TRX = 1,000,000 SUN
): Promise<string> {
  const options = {
    feeLimit: feeLimit,
    callValue: callValue
  }
  const issuerAddress = tronWeb.defaultAddress.base58
  const transactionObject = await tronWeb.transactionBuilder.triggerSmartContract(
    contractAddress,
    functionSelector,
    options,
    parameters,
    tronWeb.address.toHex(issuerAddress)
  )

  console.log('transactionObject: ', JSON.stringify(transactionObject))

  if (!transactionObject.result || !transactionObject.result.result) {
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    throw new Error(`Unknown error: ${transactionObject.result}`)
  }

  const signedTransaction = await tronWeb.trx.sign(transactionObject.transaction)
  if (!signedTransaction.signature) {
    throw new Error('Transaction was not signed properly')
  }

  const tx = await tronWeb.trx.sendRawTransaction(signedTransaction)
  const txId = tx?.transaction?.txID
  if (!(typeof txId === 'string')) {
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    throw new Error(`Invalid transaction format for ${tx?.transaction?.txID}`)
  }
  return txId
}

export async function waitForTx(tronWeb: any, txId: string, initialWaitTime: number): Promise<string | null> {
  await delay(initialWaitTime)

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const tx = await tronWeb.trx.getTransactionInfo(txId)
    if (Object.keys(tx).length === 0) {
      // no transaction in blockchain
      await delay(2_000) // 2 seconds
    } else {
      if (tx.receipt != 'SUCCESS') {
        return Buffer.from(tx.contractResult[0], 'hex').toString('utf8')
      }
      return null
    }
  }
}

// In the SC: abi.encode(userAddress, idoAddress)
export async function whitelistSignatureIDO(
  userAddress: string,
  idoAddress: string,
  signer: SignerWithAddress
): Promise<string> {
  const encoded = web3.eth.abi.encodeParameters(['address', 'address'], [userAddress, idoAddress])
  const messageHash = ethers.utils.keccak256(encoded)
  return signer.signMessage(ethers.utils.arrayify(messageHash))
}