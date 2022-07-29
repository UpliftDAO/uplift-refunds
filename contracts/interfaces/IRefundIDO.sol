// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.8;

import { IReferrer } from "./IReferrer.sol";

interface IRefundIDO is IReferrer {
    function referrersInfoOf(address account_) external view returns (address, Referrer[] memory);

    function pricePerTokenInUQ() external view returns (uint256);

    function amountOf(address account_) external view returns (uint256);
}
