// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.8;

import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/**
 * @title Contract for role checking
 * @notice Adds DEFAULT_ADMIN_ROLE
 */
abstract contract BaseRoleChecker {
    bytes32 public constant DEFAULT_ADMIN_ROLE = 0x00;

    address internal registry_;

    /**
     * @notice BaseRoleChecker initialization. Should be called in all contract which inerits BaseRoleChecker
     */
    function __BaseRoleChecker_init(address registry) internal {
        require(IERC165(registry).supportsInterface(type(IAccessControl).interfaceId), "BRC:I");
        registry_ = registry;
    }

    /**
     * @notice Checks if msg.sender has {role}
     */
    modifier onlyRole(bytes32 role) {
        require(IAccessControl(registry_).hasRole(role, msg.sender), "BRC:F");
        _;
    }
}
