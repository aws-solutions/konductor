// SPDX-License-Identifier: Apache-2.0
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import type { ParamBox } from './run-params';

const REQUIRED = 'A value is needed to run.';

const OPTIONAL_WITH_DEFAULT =
  'Left empty, the run takes the value the workflow declares.';

function constraintOf(box: ParamBox): string {
  return box.required ? REQUIRED : OPTIONAL_WITH_DEFAULT;
}

/**
 * The boxes for the params the workflow declares, under the Goal box, in the
 * order of the file. Each one is labelled with the param's name, so a person
 * reads the same name here and in the file, and starts out with the declared
 * default in it. It adds no live region: the Run button says why it is off.
 */
export function ParamFields({
  params,
  readOnly,
  onParam,
}: {
  readonly params: readonly ParamBox[];
  /** True while a run that was already going owns the boxes. */
  readonly readOnly: boolean;
  onParam: (name: string, text: string) => void;
}) {
  if (params.length === 0) return null;
  return (
    <SpaceBetween size="m">
      {params.map((box) => (
        <FormField
          key={box.name}
          label={box.name}
          {...(box.description === undefined
            ? {}
            : { description: box.description })}
          constraintText={constraintOf(box)}
          {...(box.problem === undefined ? {} : { errorText: box.problem })}
        >
          <Input
            value={readOnly ? '' : box.value}
            placeholder={readOnly ? 'Not known' : undefined}
            readOnly={readOnly}
            data-testid={`run-param-${box.name}`}
            onChange={({ detail }) => onParam(box.name, detail.value)}
          />
        </FormField>
      ))}
    </SpaceBetween>
  );
}
