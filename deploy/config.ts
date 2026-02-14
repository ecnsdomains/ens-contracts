import { labelhash, namehash } from 'viem'

/**
 * Deploy configuration — parameterizes TLD for chain-agnostic deployment.
 * Change TLD here to deploy on any chain (e.g., 'eth', 'etc', 'bnb').
 */
export const TLD = 'etc'
export const TLD_LABEL_HASH = labelhash(TLD)
export const TLD_NODE = namehash(TLD)
export const RESOLVER_NODE = namehash(`resolver.${TLD}`)
