//SPDX-License-Identifier: MIT
pragma solidity >=0.8.17 <0.9.0;

import {ECNS} from "../../../contracts/registry/ECNS.sol";
import {ReverseClaimer} from "../../../contracts/reverseRegistrar/ReverseClaimer.sol";

contract MockReverseClaimerImplementer is ReverseClaimer {
    constructor(ECNS ecns, address claimant) ReverseClaimer(ecns, claimant) {}
}
