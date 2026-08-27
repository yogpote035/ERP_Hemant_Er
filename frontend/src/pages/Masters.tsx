import { MasterTabs } from '@/masters/MasterTabs'
import { MASTER_SPECS } from '@/masters/registry'

/** Masters module — Units, Parts, Vendors, Customers, Machines, Operations, Employees, Opening stock. */
export default function Masters() {
  return <MasterTabs specs={MASTER_SPECS} />
}
