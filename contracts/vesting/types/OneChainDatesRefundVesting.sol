// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.8;

import { DatesVestingLibrary } from "../../libraries/DatesVestingLibrary.sol";
import { OneChainRefundVesting } from "../chains/OneChainRefundVesting.sol";

contract OneChainDatesRefundVesting is OneChainRefundVesting {
    using DatesVestingLibrary for DatesVestingLibrary.Data;

    // [token][identifier]
    mapping(address => mapping(address => DatesVestingLibrary.Data)) private vestingDataByToken;

    function initialize(
        address registry_,
        InitializeInfo calldata initializeInfo_,
        bytes calldata data_
    ) external virtual override initializer {
        _baseInitialize(registry_, initializeInfo_);
        _addTokenInfo(initializeInfo_, data_);
    }

    function addTokenInfo(InitializeInfo calldata initializeInfo_, bytes calldata data_)
        external
        override
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        _setInitializeInfo(initializeInfo_);
        _addTokenInfo(initializeInfo_, data_);
    }

    function infoOf(
        address token_,
        address identifier_,
        address account_
    ) external view returns (DatesVestingLibrary.Data memory vestingInfo, ReturnInfo memory refundInfo) {
        vestingInfo = vestingDataByToken[token_][identifier_];
        (refundInfo) = _baseInfoOf(token_, identifier_, account_);
    }

    function _withdrawableOf(
        address token_,
        address identifier_,
        uint256 total_,
        uint256 vested_
    ) internal view override returns (uint256) {
        return vestingDataByToken[token_][identifier_].availableOutputAmount(total_, vested_);
    }

    function _addTokenInfo(InitializeInfo calldata initializeInfo_, bytes calldata data_) private {
        (uint64 bpPrecision_, uint64 tgePercentage_, uint32 tgeDate_, uint32[] memory vestingDates_) = abi.decode(
            data_,
            (uint64, uint64, uint32, uint32[])
        );
        vestingDataByToken[initializeInfo_.token][initializeInfo_.identifier].initialize(
            bpPrecision_,
            tgePercentage_,
            tgeDate_,
            vestingDates_
        );
    }
}
