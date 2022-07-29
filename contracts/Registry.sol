// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.8;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";

contract Registry is AccessControl {
    constructor(address _admin) {
        _setupRole(DEFAULT_ADMIN_ROLE, _admin);
    }
}
