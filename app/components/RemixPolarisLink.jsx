// app/components/RemixPolarisLink.jsx

import { Link as RemixLink } from "@remix-run/react"; // RemixNavLink is removed
import { Link as PolarisLink } from "@shopify/polaris";
import { forwardRef } from "react";

// This is a custom component that combines Remix's Link with Polaris's Link styling
const RemixPolarisLink = forwardRef(
  ({ url, children, ...rest }, ref) => {
    return (
      <PolarisLink url={url} {...rest} as={RemixLink} to={url}>
        {children}
      </PolarisLink>
    );
  }
);

// Add the displayName to satisfy the linter rule
RemixPolarisLink.displayName = "RemixPolarisLink";

export default RemixPolarisLink;