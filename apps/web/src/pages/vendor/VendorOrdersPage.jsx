import PageHeader from "../../components/common/PageHeader";
import VendorQueue from "./VendorQueue";

export default function VendorOrdersPage() {
  return (
    <div>
      <PageHeader title="My Orders" subtitle="Accept, stamp and upload each certificate. Grouped by batch." />
      <VendorQueue />
    </div>
  );
}
