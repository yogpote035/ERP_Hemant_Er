import { MasterTabs } from '@/masters/MasterTabs'
import { RATE_SPECS } from '@/masters/registry'

/** Rate masters — versioned RM rates and production rates. */
export default function Rates() {
  return <MasterTabs specs={RATE_SPECS} />
}
