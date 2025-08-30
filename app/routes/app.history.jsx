import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, Form } from "@remix-run/react";
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
  InlineStack,
  Popover,
  DatePicker,
  TextField,
  EmptyState,
  ActionList,
} from "@shopify/polaris";
import { CalendarIcon, CaretDownIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import RemixPolarisLink from "../components/RemixPolarisLink";

function formatDate(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = (`0${d.getMonth() + 1}`).slice(-2);
  const day = (`0${d.getDate()}`).slice(-2);
  return `${year}-${month}-${day}`;
}

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  const url = new URL(request.url);
  const startDate = url.searchParams.get("startDate");
  const endDate = url.searchParams.get("endDate");

  const whereClause = { isArchived: false };
  if (startDate && endDate) {
    whereClause.createdAt = {
      gte: new Date(startDate),
      lte: new Date(new Date(endDate).getTime() + 86400000), // Add 1 day to include the end date
    };
  }

  const savedReturns = await prisma.savedReturn.findMany({
    where: whereClause,
    orderBy: {
      createdAt: "desc",
    },
  });

  return json({ savedReturns, startDate, endDate });
};

export const action = async ({ request }) => {
  await authenticate.admin(request);
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  await prisma.savedReturn.updateMany({
    where: {
      isArchived: false,
    },
    data: {
      isArchived: true,
    },
  });
  return json({ archived: true });
};

export default function HistoryPage() {
  const { savedReturns, startDate: initialStartDate, endDate: initialEndDate } = useLoaderData();
  const submit = useSubmit();

  const [isModalOpen, setIsModalOpen] = useState(false);
  
  const [startDatePopoverActive, setStartDatePopoverActive] = useState(false);
  const [startDate, setStartDate] = useState(initialStartDate ? new Date(initialStartDate) : new Date());
  const [{startMonth, startYear}, setStartMonthYear] = useState({startMonth: startDate.getMonth(), startYear: startDate.getFullYear()});

  const [endDatePopoverActive, setEndDatePopoverActive] = useState(false);
  const [endDate, setEndDate] = useState(initialEndDate ? new Date(initialEndDate) : new Date());
  const [{endMonth, endYear}, setEndMonthYear] = useState({endMonth: endDate.getMonth(), endYear: endDate.getFullYear()});

  const [presetPopoverActive, setPresetPopoverActive] = useState(false);
  const togglePresetPopover = useCallback(() => setPresetPopoverActive((active) => !active), []);

  const handleOpenModal = useCallback(() => setIsModalOpen(true), []);
  const handleCloseModal = useCallback(() => setIsModalOpen(false), []);
  const handleArchiveHistory = () => {
    submit({}, { method: "post" });
    handleCloseModal();
  };
  
  const toggleStartDatePopover = useCallback(() => setStartDatePopoverActive(active => !active), []);
  const toggleEndDatePopover = useCallback(() => setEndDatePopoverActive(active => !active), []);

  const handlePresetClick = (preset) => {
    const today = new Date();
    let newStartDate;
    let newEndDate = new Date();

    switch(preset) {
        case '7days':
            newStartDate = new Date();
            newStartDate.setDate(today.getDate() - 7);
            break;
        case '30days':
            newStartDate = new Date();
            newStartDate.setDate(today.getDate() - 30);
            break;
        case 'quarter':
            newStartDate = new Date(today);
            const currentMonth = newStartDate.getMonth();
            const lastQuarterStartMonth = Math.floor(currentMonth / 3) * 3 - 3;
            newStartDate.setMonth(lastQuarterStartMonth, 1);
            
            newEndDate = new Date(newStartDate);
            newEndDate.setMonth(newStartDate.getMonth() + 3, 0);
            break;
        case 'year':
            newStartDate = new Date(today.getFullYear(), 0, 1);
            break;
        default:
            newStartDate = new Date();
    }
    
    setStartDate(newStartDate);
    setEndDate(newEndDate);

    const formData = new FormData();
    formData.append('startDate', formatDate(newStartDate));
    formData.append('endDate', formatDate(newEndDate));
    submit(formData, { method: 'get' });
  };

  const resourceName = {
    singular: "return",
    plural: "returns",
  };

  const rowMarkup = savedReturns.map(
    ({ id, shopifyOrderName, createdAt, returnReason, productCondition, returnShippingCost, handlingFee, totalRevenueLost, netProfitChange }, index) => (
      <IndexTable.Row id={id} key={id} position={index}>
        <IndexTable.Cell><Text variant="bodyMd" fontWeight="bold" as="span">{shopifyOrderName}</Text></IndexTable.Cell>
        <IndexTable.Cell>{new Date(createdAt).toLocaleDateString()}</IndexTable.Cell>
        <IndexTable.Cell>{returnReason}</IndexTable.Cell>
        <IndexTable.Cell>{productCondition}</IndexTable.Cell>
        <IndexTable.Cell>${parseFloat(returnShippingCost).toFixed(2)}</IndexTable.Cell>
        <IndexTable.Cell>${parseFloat(handlingFee).toFixed(2)}</IndexTable.Cell>
        <IndexTable.Cell><Text tone="critical">${parseFloat(totalRevenueLost).toFixed(2)}</Text></IndexTable.Cell>
        <IndexTable.Cell><Text tone={netProfitChange < 0 ? "critical" : "success"} fontWeight="semibold">${parseFloat(netProfitChange).toFixed(2)}</Text></IndexTable.Cell>
      </IndexTable.Row>
    )
  );

  const emptyStateMarkup = (
    <EmptyState
        heading="No return history found"
        image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
    >
        <p>There are no saved returns to display for the selected date range.</p>
    </EmptyState>
  );

  return (
    <Page>
      <Modal open={isModalOpen} onClose={handleCloseModal} title="Archive all saved history?" primaryAction={{ content: "Archive All", onAction: handleArchiveHistory }} secondaryActions={[{ content: "Cancel", onAction: handleCloseModal }]}>
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p" variant="bodyMd">This will move all current return records to the archive. You can view and permanently delete them from there.</Text>
            <Text as="p" variant="bodyMd" tone="critical"><strong>Note: Archiving these records will remove them from the At-a-Glance Analytics on the main page.</strong></Text>
          </BlockStack>
        </Modal.Section>
      </Modal>

      <BlockStack gap="500">
        <RemixPolarisLink url="/app"><Text variant="bodySm" as="p">← Back to Calculator</Text></RemixPolarisLink>
        
        <Card>
            <BlockStack gap="400">
                <Text variant="headingMd" as="h2">Filter History by Date</Text>
                <Form method="get">
                    <InlineStack gap="400" align="end" wrap={false}>
                        <Popover active={presetPopoverActive} activator={<Button onClick={togglePresetPopover} icon={CaretDownIcon}>Presets</Button>} autofocusTarget="none" onClose={togglePresetPopover}>
                            <ActionList actionRole="menuitem" items={[
                                {content: 'Last 7 Days', onAction: () => { handlePresetClick('7days'); togglePresetPopover(); }},
                                {content: 'Last 30 Days', onAction: () => { handlePresetClick('30days'); togglePresetPopover(); }},
                                {content: 'Last Quarter', onAction: () => { handlePresetClick('quarter'); togglePresetPopover(); }},
                                {content: 'This Year', onAction: () => { handlePresetClick('year'); togglePresetPopover(); }},
                            ]}/>
                        </Popover>
                        <Popover active={startDatePopoverActive} activator={<TextField label="Start Date" value={formatDate(startDate)} onFocus={toggleStartDatePopover} prefix={<CalendarIcon/>} autoComplete="off" />} autofocusTarget="none" onClose={toggleStartDatePopover}>
                            <DatePicker month={startMonth} year={startYear} onChange={(range) => { setStartDate(range.start); toggleStartDatePopover(); }} onMonthChange={(month, year) => setStartMonthYear({startMonth: month, startYear: year})} selected={startDate} />
                        </Popover>
                        <Popover active={endDatePopoverActive} activator={<TextField label="End Date" value={formatDate(endDate)} onFocus={toggleEndDatePopover} prefix={<CalendarIcon/>} autoComplete="off" />} autofocusTarget="none" onClose={toggleEndDatePopover}>
                            <DatePicker month={endMonth} year={endYear} onChange={(range) => { setEndDate(range.start); toggleEndDatePopover(); }} onMonthChange={(month, year) => setEndMonthYear({endMonth: month, endYear: year})} selected={endDate} />
                        </Popover>
                        <input type="hidden" name="startDate" value={formatDate(startDate)} />
                        <input type="hidden" name="endDate" value={formatDate(endDate)} />
                        <Button submit variant="primary">Filter</Button>
                    </InlineStack>
                </Form>
            </BlockStack>
        </Card>
        
        <Card>
          <BlockStack gap="500">
            <Box paddingBlockEnd="200" style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <RemixPolarisLink url="/app/archive"><Button>View Archived History →</Button></RemixPolarisLink>
            </Box>
            <Box style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Text variant="headingLg" as="h1">Active Return History</Text>
              <Button onClick={handleOpenModal} variant="primary" disabled={savedReturns.length === 0}>Archive All</Button>
            </Box>
            <IndexTable resourceName={resourceName} itemCount={savedReturns.length} emptyState={emptyStateMarkup} headings={[{ title: "Order" }, { title: "Date Saved" }, { title: "Reason" }, { title: "Condition" }, { title: "Shipping Cost" }, { title: "Handling Fee" }, { title: "Revenue Lost" }, { title: "Net Profit/Loss" }]} selectable={false}>
              {rowMarkup}
            </IndexTable>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}