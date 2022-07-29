// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.8;

interface IBaseRefundRequester {
    /**
    percentInBP - starts from 0 to 10_000 for each KPI (value should accumulate all prev values)
     */
    struct KPI {
        uint32 dateRequestStart;
        uint32 dateRequestEnd;
        uint64 percentInBP;
        uint64 multiplierInBP;
        bool isFullRefund;
        bool refundable;
    }

    struct AccountInfo {
        uint256 refundRequestedInToken;
        uint256 refundRequestedWithMultiplierInToken;
        uint256 claimedRefundRequestedInToken;
        mapping(uint8 => uint256) refundRequestedByKPIInToken;
    }

    struct RefundInfo {
        address vesting;
        address projectFundsHolder;
        KPI[] KPIs;
        uint64 bpPrecision;
        mapping(uint8 => uint256) totalRefundRequestedByKPI;
        mapping(address => AccountInfo) accountInfoOf;
    }

    // Initialization
    struct InitializeRefundInfo {
        address token;
        address identifier;
        address vesting;
        address projectFundsHolder;
        KPI[] KPIs;
        uint64 bpPrecision;
    }

    // Info
    struct ReturnAccountInfo {
        uint256 refundRequestedInToken;
        uint256 refundRequestedWithMultiplierInToken;
        uint256 claimedRefundRequestedInToken;
        uint256[] refundRequestedByKPIInToken;
    }

    struct ReturnRefundInfo {
        address projectFundsHolder;
        KPI[] KPIs;
        uint64 bpPrecision;
        uint256[] totalRefundRequestedByKPI;
        ReturnAccountInfo accountInfoOf;
    }

    function setRefundable(
        address token_,
        address identifier_,
        uint8 index_,
        bool isRefundable_
    ) external;

    function setProjectFundsHolder(
        address token_,
        address identifier_,
        address projectFundsHolder_
    ) external;

    function setKPI(
        address token_,
        address identifier_,
        uint8 KPIIndex_,
        KPI calldata KPI_
    ) external;

    function requestRefund(
        address token_,
        address identifier_,
        uint256 refundInToken_, // 0 if only unvested refund
        uint8 KPIIndex_,
        bytes calldata data_
    ) external;

    function infoOf(
        address token_,
        address identifier_,
        address account_
    ) external view returns (ReturnRefundInfo memory info);

    event SetKPI(
        address indexed token,
        address indexed identifier,
        uint8 indexed KPIIndex,
        uint32 dateRequestStart,
        uint32 dateRequestEnd,
        uint64 percentInBP,
        uint64 multiplierInBP,
        bool isFullRefund,
        bool refundable
    );
    event SetVesting(address indexed token, address indexed identifier, address vesting);
    event SetProjectFundsHolder(address indexed token, address indexed identifier, address projectFundsHolder);
    event SetRefundable(address indexed token, address indexed identifier, uint8 index, bool isRefundable);
    event SetBPPrecision(address indexed token, address indexed identifier, uint64 bpPrecision);
    // amountToRefundInToken - total refunded
    // payedClaimedAmontInToken - tokens that user bring after claim (amountInToken >= claimedAmontInToken)
    event RequestRefund(
        address indexed token,
        address indexed identifier,
        address indexed account,
        uint256 amountToRefundInToken,
        uint256 payedClaimedAmountInToken,
        uint8 kpiIndex
    );
}
