// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.8;

/**
 * @title Base interface for requesting refunds
 * @notice Base interface implements function for both one- and multi- chain refund requesters
 */
interface IBaseRefundRequester {
    /**
     * @notice KPI model
     * dateRequestStart - timestamp when users can start request refunds for KPI (if KPI is refundable)
     * dateRequestEnd - end timestamp when we stop getting request refunds (if KPI is refundable), dateRequestEnd > dateRequestStart
     * percentInBP - accumulated percent for this KPI (ex. if 1st KPI's percentInBP is 25% and 2 KPI's percentInBP is 50% then 25% will be refunded for 2 KPI (50%-255))
     * Each project has custom BP, so this value starts from 0 to bpPrecision for each KPI
     * multiplierInBP - how many tokens will be converted to buy token (ex. is percentInBP is 25% and multiplierInBP is 90% it means that 90% of this 25% will be converted to buy token)
     * Each project has custom BP, so this value starts from 0 to bpPrecision for each KPI
     * isFullRefund - we have special requirements for full refund (we return 100% of user investment and burn referral shares)
     * isRefundable - is refund available for this KPI
     */
    struct KPI {
        uint32 dateRequestStart;
        uint32 dateRequestEnd;
        uint64 percentInBP;
        uint64 multiplierInBP;
        bool isFullRefund;
        bool isRefundable;
        bool isClaimable;
    }

    /**
     * @notice Account model
     * refundRequestedInToken - how many tokens user requested for refund (total without multiplier)
     * claimedRefundRequestedInToken - how many tokens user requested for refund and which was bringed by user itself
     * refundRequestedByKPIInToken - how many tokens user requested for refund (for each KPI without multiplier)
     * refundRequestedWithMultiplierByKPIInToken - how many tokens user requested for refund (for each KPI with multiplier)
     * actualRefundRequestedWithMultiplierByKPIInToken - how many tokens user requested for refund (for each KPI without multiplier). Each index represent KPI's number.
     * May differ from refundRequestedByKPIInToken for deflationary tokens. Should be used for any external calls
     */
    struct AccountInfo {
        uint256 refundRequestedInToken;
        uint256 claimedRefundRequestedInToken;
        mapping(uint8 => uint256) refundRequestedByKPIInToken;
        mapping(uint8 => uint256) refundRequestedWithMultiplierByKPIInToken;
        mapping(uint8 => uint256) actualRefundRequestedWithMultiplierByKPIInToken;
    }

    /**
     * @notice Refund model (for each project)
     * vesting - vesting address, can't be zero address
     * projectFundsHolder - account which receives all token which users bring for specific project, can't be zero address
     * KPIs - array of KPIs for this project
     * bpPrecision - specific BP precision for this project
     * totalRefundRequestedByKPI - how many tokens users requested for specific KPI
     * accountInfoOf - info for each accounts who asked for refund
     */
    struct RefundInfo {
        address vesting;
        address projectFundsHolder;
        KPI[] KPIs;
        uint64 bpPrecision;
        mapping(uint8 => uint256) totalRefundRequestedByKPI;
        mapping(address => AccountInfo) accountInfoOf;
    }

    // Initialization
    /**
     * @notice Initilization info (for each project)
     * token - refunded token, can't be zero address
     * identifier - unique identifier for refund, can be zero address (for one-chain refund it will be IDO address)
     * vesting - vesting address, can't be zero address
     * projectFundsHolder - account who receives all tokens which users bring for specific project, can't be zero address
     * KPIs - array of KPIs for this project
     * bpPrecision - specific BP precision for this project
     */
    struct InitializeRefundInfo {
        address token;
        address identifier;
        address vesting;
        address projectFundsHolder;
        KPI[] KPIs;
        uint64 bpPrecision;
    }

    // Info
    /**
     * @notice Return info for account
     * refundRequestedInToken - how many tokens user requested for refund (total without multiplier)
     * claimedRefundRequestedInToken - how many tokens user requested for refund and which was bringed by user itself
     * refundRequestedByKPIInToken - how many tokens user requested for refund (for each KPI without multiplier). Each index represent KPI's number
     * actualRefundRequestedWithMultiplierByKPIInToken - how many tokens user requested for refund (for each KPI without multiplier). Each index represent KPI's number.
     * May differ from refundRequestedByKPIInToken for deflationary tokens. Should be used for any external calls
     */
    struct ReturnAccountInfo {
        uint256 refundRequestedInToken;
        uint256 claimedRefundRequestedInToken;
        uint256[] refundRequestedByKPIInToken;
        uint256[] refundRequestedWithMultiplierByKPIInToken;
        uint256[] actualRefundRequestedWithMultiplierByKPIInToken;
    }

    /**
     * @notice Return info for refund
     * projectFundsHolder - account which receives all token which users bring for specific project, can't be zero address
     * KPIs - array of KPIs for this project
     * bpPrecision - specific BP precision for this project
     * totalRefundRequestedByKPI - how many tokens users requested for specific KPI
     * accountInfoOf - info for account(for this refund)
     */
    struct ReturnRefundInfo {
        address projectFundsHolder;
        KPI[] KPIs;
        uint64 bpPrecision;
        uint256[] totalRefundRequestedByKPI;
        ReturnAccountInfo accountInfoOf;
    }

    /**
     * @notice Set KPI in the project refundable
     * @param token_ - refunded token, can't be zero address
     * @param identifier_ - unique identifier for refund, can be zero address (for one-chain refund it will be IDO address)
     * @param index_ - KPI's index
     * @param isRefundable_ - is KPI refundable
     */
    function setRefundable(
        address token_,
        address identifier_,
        uint8 index_,
        bool isRefundable_
    ) external;

    /**
     * @notice Set account who receives all tokens which users bring for specific project
     * @param token_ - refunded token, can't be zero address
     * @param identifier_ - unique identifier for refund, can be zero address (for one-chain refund it will be IDO address)
     * @param projectFundsHolder_ - new account
     */
    function setProjectFundsHolder(
        address token_,
        address identifier_,
        address projectFundsHolder_
    ) external;

    /**
     * @notice Set KPI as claimable
     * @param token_ - refunded token, can't be zero address
     * @param identifier_ - unique identifier for refund, can be zero address (for one-chain refund it will be IDO address)
     * @param KPIIndex_ - KPI's index
     * @param isClaimable_ - is claimable KPI
     */
    function setClaimableKPI(
        address token_,
        address identifier_,
        uint8 KPIIndex_,
        bool isClaimable_
    ) external;

    /**
     * @notice Change specific KPI data
     * @param token_ - refunded token, can't be zero address
     * @param identifier_ - unique identifier for refund, can be zero address (for one-chain refund it will be IDO address)
     * @param KPIIndex_ - KPI's index
     * @param KPI_ - new KPI data
     */
    function setKPI(
        address token_,
        address identifier_,
        uint8 KPIIndex_,
        KPI calldata KPI_
    ) external;

    /**
     * @notice Request refund for project
     * @param token_ - refunded token, can't be zero address
     * @param identifier_ - unique identifier for refund, can be zero address (for one-chain refund it will be IDO address)
     * @param refundInToken_ - amount which user wants to return after claim (0 if only unvested refund)
     * @param KPIIndex_ - KPI's index
     * @param data_ - specific data (different for one- and multi- chain refunds)
     */
    function requestRefund(
        address token_,
        address identifier_,
        uint256 refundInToken_,
        uint8 KPIIndex_,
        bytes calldata data_
    ) external;

    /**
     * @notice Get all info about refund
     * @param token_ - refunded token, can't be zero address
     * @param identifier_ - unique identifier for refund, can be zero address (for one-chain refund it will be IDO address)
     * @param account_ - account address to get info about (can be zero address)
     * @return info - refund's info
     */
    function infoOf(
        address token_,
        address identifier_,
        address account_
    ) external view returns (ReturnRefundInfo memory info);

    /**
     * @dev Emitted when KPI info is set
     */
    event SetKPI(
        address indexed token,
        address indexed identifier,
        uint8 indexed KPIIndex,
        uint32 dateRequestStart,
        uint32 dateRequestEnd,
        uint64 percentInBP,
        uint64 multiplierInBP,
        bool isFullRefund,
        bool isRefundable
    );
    /**
     * @dev Emitted when vesting is added
     */
    event SetVesting(address indexed token, address indexed identifier, address vesting);
    /**
     * @dev Emitted when project funds holder is added
     */
    event SetProjectFundsHolder(address indexed token, address indexed identifier, address projectFundsHolder);
    /**
     * @dev Emitted when KPI's refundable status changes
     */
    event SetRefundable(address indexed token, address indexed identifier, uint8 index, bool isRefundable);
    /**
     * @dev Emitted when project's precision is added
     */
    event SetBPPrecision(address indexed token, address indexed identifier, uint64 bpPrecision);
    /**
     * @dev Emitted when KPI's claimable status changes
     */
    event SetClaimableKPI(address indexed token, address indexed identifier, uint8 KPIIndex, bool isClaimable);
    /**
     * @dev Emitted when user requests for refund
     * amountToRefundInToken - total refunded
     * payedClaimedAmontInToken - tokens that user bring after claim (amountInToken >= claimedAmontInToken)
     */
    event RequestRefund(
        address indexed token,
        address indexed identifier,
        address indexed account,
        uint256 amountToRefundInToken,
        uint256 actualAmountToRefundInToken,
        uint256 payedClaimedAmountInToken,
        uint8 kpiIndex
    );
}
