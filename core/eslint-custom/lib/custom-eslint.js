"use strict";
/*
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.customESLint = void 0;
/* eslint-disable @typescript-eslint/no-explicit-any */
const import_convention_1 = require("./rules/import-convention");
const rules = Object.assign({}, import_convention_1.importConvention.rules);
exports.customESLint = {
    plugins: ['security', 'import'],
    extends: [
        '@rushstack/eslint-config/profile/node',
        '@rushstack/eslint-config/mixins/tsdoc',
        'plugin:security/recommended',
        'plugin:import/recommended',
        'plugin:import/typescript'
    ],
    rules: Object.assign(Object.assign({}, rules), { '@typescript-eslint/naming-convention': 'off' }),
    settings: {
        'import/parsers': {
            '@typescript-eslint/parser': ['.ts', '.tsx']
        },
        'import/resolver': {
            typescript: {
                alwaysTryTypes: true
            }
        }
    }
};
//# sourceMappingURL=custom-eslint.js.map