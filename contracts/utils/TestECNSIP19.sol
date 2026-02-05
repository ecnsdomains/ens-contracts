// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {ECNSIP19} from "./ECNSIP19.sol";

contract TestECNSIP19 {
    function reverseName(
        bytes memory encodedAddress,
        uint256 coinType
    ) external pure returns (string memory) {
        return ECNSIP19.reverseName(encodedAddress, coinType);
    }

    function parse(
        bytes memory name
    ) external pure returns (bytes memory, uint256) {
        return ECNSIP19.parse(name);
    }

    function parseNamespace(
        bytes memory name,
        uint256 offset
    ) external pure returns (bool, uint256) {
        return ECNSIP19.parseNamespace(name, offset);
    }

    function chainFromCoinType(
        uint256 coinType
    ) external pure returns (uint32) {
        return ECNSIP19.chainFromCoinType(coinType);
    }

    function isEVMCoinType(uint256 coinType) external pure returns (bool) {
        return ECNSIP19.isEVMCoinType(coinType);
    }
}
