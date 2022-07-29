// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.8;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

library DatesVestingLibrary {
    struct Data {
        uint64 bpPrecision;
        uint64 tgePercentage;
        uint32 tgeDate;
        uint64 vestingPercentage;
        uint32[] vestingDates;
    }

    function initialize(
        Data storage self_,
        uint64 bpPrecision_,
        uint64 tgePercentage_,
        uint32 tgeDate_,
        uint32[] memory vestingDates_
    ) internal {
        require(tgeDate_ > 0, "DVL:Z");
        for (uint256 i; i < vestingDates_.length; ++i) {
            require(i > 0 ? vestingDates_[i] > vestingDates_[i - 1] : vestingDates_[0] > tgeDate_, "DVL:I");
        }

        self_.bpPrecision = bpPrecision_;
        self_.tgePercentage = tgePercentage_;
        self_.tgeDate = tgeDate_;
        self_.vestingDates = vestingDates_;
        if (vestingDates_.length > 0) {
            self_.vestingPercentage = uint64((bpPrecision_ - tgePercentage_) / vestingDates_.length);
        } else {
            require(self_.tgePercentage == bpPrecision_, "DVL:I");
        }
    }

    function availableOutputAmount(
        Data storage self_,
        uint256 max_,
        uint256 amountVested_
    ) internal view returns (uint256) {
        // Before TGE date or all already vested
        if (block.timestamp < self_.tgeDate || amountVested_ == max_) {
            return 0;
        }
        // If TGE already passed and no vesting or last vesting date already passed
        if (self_.vestingDates.length == 0 || block.timestamp >= self_.vestingDates[self_.vestingDates.length - 1]) {
            return max_ - amountVested_;
        }

        uint256 vestingIntervals;
        while (
            vestingIntervals < self_.vestingDates.length && block.timestamp >= self_.vestingDates[vestingIntervals]
        ) {
            vestingIntervals++;
        }

        uint256 sumOfPercentages = self_.tgePercentage + (self_.vestingPercentage * vestingIntervals);
        return (max_ * sumOfPercentages) / self_.bpPrecision - amountVested_;
    }

    function vestingDetails(Data storage self_)
        internal
        view
        returns (
            uint64,
            uint64,
            uint32,
            uint64,
            uint32[] memory
        )
    {
        return (self_.bpPrecision, self_.tgePercentage, self_.tgeDate, self_.vestingPercentage, self_.vestingDates);
    }
}
