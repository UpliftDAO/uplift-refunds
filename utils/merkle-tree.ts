import { keccak256, bufferToHex } from 'ethereumjs-util'

export default class MerkleTree {
  elements: Buffer[]

  layers: Buffer[][]

  constructor(elements: Buffer[]) {
    // Filter empty strings and hash elements
    //this.elements = elements.filter(el => el).map(el => keccak256(el));
    this.elements = elements.filter(el => el)

    // Sort elements
    this.elements.sort(Buffer.compare)
    // Deduplicate elements
    this.elements = this.bufDedup(this.elements)

    // Create layers
    this.layers = this.getLayers(this.elements)
  }

  getLayers(elements: Buffer[]): Buffer[][] {
    if (elements.length === 0) {
      return [[Buffer.from('')]]
    }

    const layers = []
    layers.push(elements)

    // Get next layer until we reach the root
    while (layers[layers.length - 1].length > 1) {
      layers.push(this.getNextLayer(layers[layers.length - 1]))
    }

    return layers
  }

  getNextLayer(elements: Buffer[]): Buffer[] {
    return elements.reduce((layer, el, idx, arr) => {
      if (idx % 2 === 0) {
        // Hash the current element with its pair element
        layer.push(this.combinedHash(el, arr[idx + 1]) as never)
      }

      return layer
    }, [])
  }

  combinedHash(first: Buffer, second: Buffer): Buffer {
    if (!first) {
      return second
    }
    if (!second) {
      return first
    }

    return keccak256(this.sortAndConcat(first, second))
  }

  getRoot(): Buffer {
    return this.layers[this.layers.length - 1][0]
  }

  getHexRoot(): string {
    return bufferToHex(this.getRoot())
  }

  getProof(el: Buffer): Buffer[] {
    let idx = this.bufIndexOf(el, this.elements)

    if (idx === -1) {
      throw new Error('Element does not exist in Merkle tree')
    }

    return this.layers.reduce((proof, layer) => {
      const pairElement = this.getPairElement(idx, layer)

      if (pairElement) {
        proof.push(pairElement)
      }

      idx = Math.floor(idx / 2)

      return proof
    }, [])
  }

  getHexProof(el: Buffer): string[] {
    const proof = this.getProof(el)

    return this.bufArrToHexArr(proof)
  }

  getPairElement(idx: number, layer: Buffer[]): Buffer | null {
    const pairIdx = idx % 2 === 0 ? idx + 1 : idx - 1

    if (pairIdx < layer.length) {
      return layer[pairIdx]
    } else {
      return null
    }
  }

  bufIndexOf(el: Buffer, arr: Buffer[]): number {
    let hash

    // Convert element to 32 byte hash if it is not one already
    if (el.length !== 32 || !Buffer.isBuffer(el)) {
      hash = keccak256(el)
    } else {
      hash = el
    }

    for (let i = 0; i < arr.length; i++) {
      if (hash.equals(arr[i])) {
        return i
      }
    }

    return -1
  }

  bufDedup(elements: Buffer[]): Buffer[] {
    return elements.filter((el, idx) => {
      return idx === 0 || !elements[idx - 1].equals(el)
    })
  }

  bufArrToHexArr(arr: Buffer[]): string[] {
    if (arr.some(el => !Buffer.isBuffer(el))) {
      throw new Error('Array is not an array of buffers')
    }

    return arr.map(el => '0x' + el.toString('hex'))
  }

  sortAndConcat(...args: Buffer[]): Buffer {
    return Buffer.concat([...args].sort(Buffer.compare))
  }
}
