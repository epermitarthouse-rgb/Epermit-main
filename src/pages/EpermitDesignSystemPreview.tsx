import { Helmet } from "react-helmet-async";
import { EpdsSections } from "@/components/demos/epds/EpdsSections";

/** Design system showroom — uses the same global theme tokens as production. */
export default function EpermitDesignSystemPreview() {
  return (
    <>
      <Helmet>
        <title>Design system preview · PermitPilot</title>
      </Helmet>
      <EpdsSections />
    </>
  );
}
