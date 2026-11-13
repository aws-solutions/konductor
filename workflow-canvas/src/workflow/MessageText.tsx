// SPDX-License-Identifier: Apache-2.0
import { Fragment } from 'react';
import { messageParts } from './message-parts';

/** A server message with each `name` in backticks shown as code, without the ticks. */
export function MessageText({ text }: { text: string }) {
  return (
    <>
      {messageParts(text).map((part, index) =>
        index % 2 === 1 ? (
          <code key={index}>{part}</code>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}
