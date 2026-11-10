import { Box, KeyValuePairs } from '@cloudscape-design/components';
import type { Member } from '../api/types';

export function ProfileCard({ member }: { member: Member }) {
  const u = member;
  return (
    <Box>
      <KeyValuePairs
        items={[
          { label: 'Name', value: u.fullName },
          { label: 'Email', value: u.email },
        ]}
      />
    </Box>
  );
}
