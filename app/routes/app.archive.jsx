import { json } from "@remix-run/node";
import { useLoaderData, useSubmit } from "@remix-run/react";
import { useState, useCallback } from "react";
import {
  Page,
  Card,
  IndexTable,
  Text,
  Button,
  Modal,
  Box,
  BlockStack,
  EmptyState,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import RemixPolarISLink from "../components/RemixPolarisLink";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const archivedReturns = await prisma.savedReturn.findMany({
    where: {
      isArchived: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });
  return json({ archivedReturns });
};

export const action = async ({ request }) => {
  await authenticate.admin(request);
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  await prisma.savedReturn.deleteMany({
    where: {
      isArchived: true,
    },
  });
  return json({ deleted: true });
};

export default function ArchivePage() {
  const { archivedReturns } = useLoaderData();
  const submit = useSubmit();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const handleOpenModal = useCallback(() => setIsModalOpen(true), []);
  const handleCloseModal = useCallback(() => setIsModalOpen(false), []);

  const handleDeleteHistory = () => {
    submit(null, { method: "post" });
    handleCloseModal();
  };

  const resourceName = {
    singular: "archived return",
    plural: "archived returns",
  };

  const rowMarkup = archivedReturns.map(
    (
      {
        id,
        shopifyOrderName,
        createdAt,
        returnReason,
        productCondition,
        returnShippingCost,
        handlingFee,
        totalRevenueLost,
        netProfitChange,
      },
      index
    ) => (
      <IndexTable.Row id={id} key={id} position={index}>
        <IndexTable.Cell>
          <Text variant="bodyMd" fontWeight="bold" as="span">
            {shopifyOrderName}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>{new Date(createdAt).toLocaleDateString()}</IndexTable.Cell>
        <IndexTable.Cell>{returnReason}</IndexTable.Cell>
        <IndexTable.Cell>{productCondition}</IndexTable.Cell>
        <IndexTable.Cell>${parseFloat(returnShippingCost).toFixed(2)}</IndexTable.Cell>
        <IndexTable.Cell>${parseFloat(handlingFee).toFixed(2)}</IndexTable.Cell>
        <IndexTable.Cell>
          <Text tone="critical">${parseFloat(totalRevenueLost).toFixed(2)}</Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text
            tone={netProfitChange < 0 ? "critical" : "success"}
            fontWeight="semibold"
          >
            ${parseFloat(netProfitChange).toFixed(2)}
          </Text>
        </IndexTable.Cell>
      </IndexTable.Row>
    )
  );

  const emptyStateMarkup = (
    <EmptyState
      heading="The archive is empty"
      image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
    >
      <p>There are currently no archived returns to display.</p>
    </EmptyState>
  );

  return (
    <Page>
      <Modal
        open={isModalOpen}
        onClose={handleCloseModal}
        title="Permanently delete all archived history?"
        primaryAction={{
          content: "Permanently Delete",
          onAction: handleDeleteHistory,
          tone: "critical",
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: handleCloseModal,
          },
        ]}
      >
        <Modal.Section>
          <Text as="p">
            This action cannot be undone. All records in the archive will be
            erased forever.
          </Text>
        </Modal.Section>
      </Modal>

      <BlockStack gap="500">
        <RemixPolarISLink url="/app/history">
          <Text variant="bodySm" as="p">
            ← Back to Active History
          </Text>
        </RemixPolarISLink>
        <Card>
          <BlockStack gap="500">
            <Box
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <Text variant="headingLg" as="h1">
                Archived Return History
              </Text>
              <Button onClick={handleOpenModal} variant="primary" tone="critical" disabled={archivedReturns.length === 0}>
                Permanently Delete All
              </Button>
            </Box>
            
            <IndexTable
              resourceName={resourceName}
              itemCount={archivedReturns.length}
              emptyState={emptyStateMarkup}
              headings={[
                { title: "Order" },
                { title: "Date Saved" },
                { title: "Reason" },
                { title: "Condition" },
                { title: "Shipping Cost" },
                { title: "Handling Fee" },
                { title: "Revenue Lost" },
                { title: "Net Profit/Loss" },
              ]}
              selectable={false}
            >
              {rowMarkup}
            </IndexTable>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}