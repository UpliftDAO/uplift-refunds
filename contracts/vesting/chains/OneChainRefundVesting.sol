// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.8;

import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

import { IRefundIDO } from "../../interfaces/IRefundIDO.sol";
import { BaseRefundVesting } from "../BaseRefundVesting.sol";

abstract contract OneChainRefundVesting is BaseRefundVesting {
    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[50] private __gap;

    function _checkIdentifier(address identifier_) internal view override {
        require(IERC165(identifier_).supportsInterface(type(IRefundIDO).interfaceId), "OCRV:I");
    }

    function _getTotalOf(address identifier_, address account_) internal view override returns (uint256) {
        return IRefundIDO(identifier_).amountOf(account_);
    }
}
