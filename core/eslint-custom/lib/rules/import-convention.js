"use strict";
/*
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.importConvention = void 0;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
exports.importConvention = {
    rules: {
        'import/no-unresolved': ['off'],
        'import/named': ['off'],
        'import/order': [
            'error',
            {
                alphabetize: {
                    order: 'asc',
                    caseInsensitive: true
                },
                groups: ['builtin', 'external', 'parent', 'sibling']
            }
        ],
        'import/newline-after-import': ['error']
    }
};
//# sourceMappingURL=import-convention.js.map