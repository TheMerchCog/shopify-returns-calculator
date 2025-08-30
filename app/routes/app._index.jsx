import { json } from "@remix-run/node";
import { useLoaderData, useActionData, Form, Link, useNavigation, useFetcher, useSubmit } from "@remix-run/react";
import {
  Page,
  BlockStack,
  Card,
  Text,
  TextField,
  Button,
  Banner,
  Checkbox,
  FormLayout,
  Select,
  Box,
  InlineStack,
  Modal,
  Grid,
  Divider,
  Popover,
  DatePicker,
  Spinner,
  ActionList,
} from "@shopify/polaris";
import { CalendarIcon, CaretDownIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import { useState, useEffect, useCallback } from "react";

// Helper function to format dates for inputs
function formatDate(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = (`0${d.getMonth() + 1}`).slice(-2);
  const day = (`0${d.getDate()}`).slice(-2);
  return `${year}-${month}-${day}`;
}

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const url = new URL(request.url);

  const startDate = url.searchParams.get("startDate");
  const endDate = url.searchParams.get("endDate");
  const orderId = url.searchParams.get("orderId");

  const whereClause = {};
  if (startDate && endDate) {
    whereClause.createdAt = {
      gte: new Date(startDate),
      lte: new Date(new Date(endDate).getTime() + 86400000),
    };
  }

  const totalReturns = await prisma.savedReturn.count({ where: whereClause });
  const aggregateData = await prisma.savedReturn.aggregate({
    where: whereClause,
    _sum: { netProfitChange: true },
  });
  const totalNetProfitLoss = aggregateData._sum.netProfitChange ?? 0;
  const reasonGroups = await prisma.savedReturn.groupBy({
    by: ['returnReason'],
    where: whereClause,
    _count: { returnReason: true },
    orderBy: { _count: { returnReason: 'desc' } },
    take: 1,
  });
  const mostFrequentReason = totalReturns > 0 ? reasonGroups[0]?.returnReason : 'N/A';
  const resellableCount = await prisma.savedReturn.count({
    where: { ...whereClause, isResellable: true },
  });
  const resellableRate = totalReturns > 0 ? (resellableCount / totalReturns) * 100 : 0;

  let preloadedOrder = null;
  if (orderId) {
    const response = await admin.graphql(
      `#graphql
      query GetOrderById($id: ID!) {
        order(id: $id) {
          id
          name
          lineItems(first: 20) {
            edges {
              node {
                id
                title
                quantity
                originalUnitPriceSet { shopMoney { amount } }
                variant { inventoryItem { unitCost { amount } } }
              }
            }
          }
        }
      }`,
      { variables: { id: orderId } }
    );
    const data = await response.json();
    preloadedOrder = data.data?.order;
  }

  return json({
    totalReturns,
    totalNetProfitLoss: totalNetProfitLoss.toFixed(2),
    mostFrequentReason,
    resellableRate: resellableRate.toFixed(1),
    preloadedOrder,
    startDate,
    endDate,
  });
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "lookupOrder") {
    const orderNumberInput = formData.get("orderNumber");
    if (!orderNumberInput || orderNumberInput.trim().length === 0) {
      return json({ error: "Please enter an order number.", intent });
    }
    let formattedOrderNumber = orderNumberInput.trim();
    if (!formattedOrderNumber.startsWith("#")) {
      formattedOrderNumber = `#${formattedOrderNumber}`;
    }
    const response = await admin.graphql(
        `#graphql
      query GetOrder($orderNumber: String!) {
        orders(first: 1, query: $orderNumber) {
          edges {
            node {
              id
              name
              lineItems(first: 20) {
                edges {
                  node {
                    id
                    title
                    quantity
                    originalUnitPriceSet { shopMoney { amount } }
                    variant { inventoryItem { unitCost { amount } } }
                  }
                }
              }
            }
          }
        }
      }`,
        { variables: { orderNumber: `name:${formattedOrderNumber}` } }
    );
    const data = await response.json();
    const order = data.data?.orders?.edges[0]?.node;
    if (!order) {
      return json({ error: `Could not find an order with the name "${formattedOrderNumber}".`, intent });
    }
    return json({ order, intent });
  }

  if (intent === "calculateReturn") {
    const returnShippingCost = parseFloat(formData.get("returnShippingCost")) || 0;
    const handlingFee = parseFloat(formData.get("handlingFee")) || 0;
    const returnedItemIds = formData.getAll("returnedItems");
    const lineItemsData = JSON.parse(formData.get("lineItemsData"));
    const orderData = JSON.parse(formData.get("orderData"));
    const productCondition = formData.get("productCondition");
    const returnReason = formData.get("returnReason");

    let totalRefund = 0;
    let totalCostOfGoods = 0;
    returnedItemIds.forEach((item) => {
      const returnedItem = lineItemsData.find((i) => i.id === item);
      if (returnedItem) {
        totalRefund += parseFloat(returnedItem.price);
        totalCostOfGoods += parseFloat(returnedItem.cost);
      }
    });

    const processingCosts = returnShippingCost + handlingFee;
    const isResellable = productCondition === 'Yes';
    
    const immediateCashOutlay = -(totalRefund + processingCosts);
    const inventoryValueLost = isResellable ? 0 : totalCostOfGoods;
    const netImpact = -(processingCosts + inventoryValueLost);

    let suggestion = "";
    let suggestionTone = "info";
    if (isResellable) {
      suggestion = `Although your immediate cash outlay is significant, the item(s) can be resold. This limits the true financial damage to the cost of processing the return. Accepting the return is likely the best path forward.`;
      suggestionTone = "info";
    } else {
      suggestion = `This return represents a true loss, as you are refunding the customer AND losing the value of the unsellable goods. To mitigate this, consider offering store credit or a partial refund without requiring a return.`;
      suggestionTone = "critical";
    }

    return json({
      order: orderData,
      intent,
      calculationResult: {
        immediateCashOutlay: immediateCashOutlay.toFixed(2),
        netImpact: netImpact.toFixed(2),
        totalRefund: totalRefund.toFixed(2),
        processingCosts: processingCosts.toFixed(2),
        inventoryValueLost: inventoryValueLost.toFixed(2),
        isResellable: isResellable,
        suggestion: suggestion,
        suggestionTone: suggestionTone,
        returnReason: returnReason,
        netProfitChange: netImpact.toFixed(2),
        totalRevenueLost: totalRefund.toFixed(2),
        inventoryValue: totalCostOfGoods.toFixed(2),
        returnShippingCost: returnShippingCost.toFixed(2),
        handlingFee: handlingFee.toFixed(2),
        productCondition: productCondition,
      },
    });
  }

  if (intent === "saveReturn") {
    const orderData = JSON.parse(formData.get("orderData"));
    const calcData = JSON.parse(formData.get("calculationResult"));

    try {
      const { PrismaClient } = await import("@prisma/client");
      const prisma = new PrismaClient();

      await prisma.savedReturn.create({
        data: {
          shopifyOrderId: orderData.id,
          shopifyOrderName: orderData.name,
          netProfitChange: parseFloat(calcData.netProfitChange),
          totalRevenueLost: parseFloat(calcData.totalRevenueLost),
          inventoryValue: parseFloat(calcData.inventoryValue),
          isResellable: calcData.isResellable,
          suggestion: calcData.suggestion,
          returnReason: calcData.returnReason,
          productCondition: calcData.productCondition === 'Yes' ? 'Can be resold as new' : 'Cannot be resold',
          returnShippingCost: parseFloat(calcData.returnShippingCost),
          handlingFee: parseFloat(calcData.handlingFee),
        },
      });

      return json({
        returnSaved: true,
      });

    } catch (e) {
      console.error("--- INLINE CLIENT FAILED ---", e);
      return json({
        error: "There was an error saving the return to the database."
      });
    }
  }

  return json({ error: "Unknown action." });
};

export default function Index() {
  const loaderData = useLoaderData();
  const { preloadedOrder, startDate: initialStartDate, endDate: initialEndDate, ...analytics } = loaderData;
  const actionData = useActionData();
  const navigation = useNavigation();
  const saveFetcher = useFetcher();
  const submit = useSubmit();

  const isLoading = navigation.state === 'loading' && navigation.formData?.get('intent') !== 'saveReturn';
  const isSaving = saveFetcher.state !== 'idle';
  
  const [order, setOrder] = useState(preloadedOrder || null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [orderNumber, setOrderNumber] = useState("");
  const [shippingCost, setShippingCost] = useState("");
  const [handlingFee, setHandlingFee] = useState("");
  const [returnReason, setReturnReason] = useState("Wrong Size");
  const [productCondition, setProductCondition] = useState("Yes");
  const [checkedItems, setCheckedItems] = useState([]);
  const [returnSaved, setReturnSaved] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [startDatePopoverActive, setStartDatePopoverActive] = useState(false);
  const [startDate, setStartDate] = useState(initialStartDate ? new Date(initialStartDate) : new Date());
  const [{startMonth, startYear}, setStartMonthYear] = useState({startMonth: startDate.getMonth(), startYear: startDate.getFullYear()});

  const [endDatePopoverActive, setEndDatePopoverActive] = useState(false);
  const [endDate, setEndDate] = useState(initialEndDate ? new Date(initialEndDate) : new Date());
  const [{endMonth, endYear}, setEndMonthYear] = useState({endMonth: endDate.getMonth(), endYear: endDate.getFullYear()});

  // --- DROPDOWN CHANGE ---
  const [presetPopoverActive, setPresetPopoverActive] = useState(false);
  const togglePresetPopover = useCallback(() => setPresetPopoverActive((active) => !active), []);
  
  const toggleStartDatePopover = useCallback(() => setStartDatePopoverActive(active => !active), []);
  const toggleEndDatePopover = useCallback(() => setEndDatePopoverActive(active => !active), []);

  useEffect(() => {
    if (!actionData) return;
    if (actionData.error) { setError(actionData.error); return; }
    setError(null);
    if (actionData.order) setOrder(actionData.order);
    if (actionData.calculationResult) setResult(actionData.calculationResult);
    if (actionData.intent === 'lookupOrder') {
        setResult(null);
        setCheckedItems([]);
        setOrderNumber("");
        setReturnSaved(false);
    }
  }, [actionData]);

  useEffect(() => {
    if (saveFetcher.data?.returnSaved) {
        setReturnSaved(true);
    } else {
        setReturnSaved(false);
    }
  }, [saveFetcher.data]);
  
  const handleOpenModal = useCallback(() => setIsModalOpen(true), []);
  const handleCloseModal = useCallback(() => setIsModalOpen(false), []);
  
  const handleSaveAndSubmit = useCallback(() => {
    const formData = new FormData();
    formData.append("intent", "saveReturn");
    formData.append("orderData", JSON.stringify(order));
    formData.append("calculationResult", JSON.stringify(result));
    saveFetcher.submit(formData, { method: "post" });
    handleCloseModal();
  }, [order, result, saveFetcher, handleCloseModal]);


  const handleOrderNumberChange = useCallback((value) => setOrderNumber(value), []);
  const handleShippingChange = useCallback((value) => setShippingCost(value), []);
  const handleHandlingChange = useCallback((value) => setHandlingFee(value), []);
  const handleReasonChange = useCallback((value) => setReturnReason(value), []);
  const handleConditionChange = useCallback((value) => setProductCondition(value), []);
  const handleCheckboxChange = useCallback((itemId) => {
    setCheckedItems((prevCheckedItems) => {
      if (prevCheckedItems.includes(itemId)) {
        return prevCheckedItems.filter((id) => id !== itemId);
      } else {
        return [...prevCheckedItems, itemId];
      }
    });
  }, []);

  const handleResetForm = useCallback(() => {
    setResult(null);
    setCheckedItems([]);
    setShippingCost("");
    setHandlingFee("");
    setReturnReason("Wrong Size");
    setProductCondition("Yes");
    setReturnSaved(false);
  }, []);

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

  const simplifiedLineItems = order?.lineItems.edges.flatMap((edge) => {
    const items = [];
    for (let i = 0; i < edge.node.quantity; i++) {
      items.push({
        id: `${edge.node.id}-${i}`,
        title: edge.node.title,
        price: edge.node.originalUnitPriceSet.shopMoney.amount,
        cost: edge.node.variant?.inventoryItem?.unitCost?.amount || 0,
      });
    }
    return items;
  }) || [];

  const reasonOptions = [
    { label: 'Wrong Size', value: 'Wrong Size' },
    { label: 'Damaged', value: 'Damaged' },
    { label: 'Did not Like', value: 'Did not Like' },
    { label: 'Other', value: 'Other' },
  ];
  const conditionOptions = [
    { label: 'Can be resold as new', value: 'Yes' },
    { label: 'Cannot be resold', value: 'No' },
  ];
  
  return (
    <Page>
      <Modal open={isModalOpen} onClose={handleCloseModal} title="Save to History?" primaryAction={{ content: 'Save Analysis', onAction: handleSaveAndSubmit, loading: isSaving }} secondaryActions={[{ content: 'Cancel', onAction: handleCloseModal }]}>
        <Modal.Section>
          <Text as="p">This will add the current calculation to your saved history and will be used in your overall return analytics. Do you want to proceed?</Text>
        </Modal.Section>
      </Modal>

      <BlockStack gap="500">
        <Card>
            <BlockStack gap="500">
                <InlineStack align="space-between" blockAlign="center" wrap={false}>
                    <Text variant="headingMd" as="h2">At-a-Glance Analytics</Text>
                    {/* --- DROPDOWN CHANGE --- */}
                    <Form method="get">
                        <InlineStack gap="300" align="end" blockAlign="end" wrap={false}>
                            <Popover active={presetPopoverActive} activator={<Button onClick={togglePresetPopover} icon={CaretDownIcon}>Presets</Button>} autofocusTarget="none" onClose={togglePresetPopover}>
                                <ActionList actionRole="menuitem" items={[
                                    {content: 'Last 7 Days', onAction: () => { handlePresetClick('7days'); togglePresetPopover(); }},
                                    {content: 'Last 30 Days', onAction: () => { handlePresetClick('30days'); togglePresetPopover(); }},
                                    {content: 'Last Quarter', onAction: () => { handlePresetClick('quarter'); togglePresetPopover(); }},
                                    {content: 'This Year', onAction: () => { handlePresetClick('year'); togglePresetPopover(); }},
                                ]}/>
                            </Popover>
                            <Popover active={startDatePopoverActive} activator={<TextField label="Start Date" labelHidden value={formatDate(startDate)} onFocus={toggleStartDatePopover} prefix={<CalendarIcon/>} autoComplete="off" />} autofocusTarget="none" onClose={toggleStartDatePopover}>
                                <DatePicker month={startMonth} year={startYear} onChange={(range) => { setStartDate(range.start); toggleStartDatePopover(); }} onMonthChange={(month, year) => setStartMonthYear({startMonth: month, startYear: year})} selected={startDate} />
                            </Popover>
                            <Popover active={endDatePopoverActive} activator={<TextField label="End Date" labelHidden value={formatDate(endDate)} onFocus={toggleEndDatePopover} prefix={<CalendarIcon/>} autoComplete="off" />} autofocusTarget="none" onClose={toggleEndDatePopover}>
                                <DatePicker month={endMonth} year={endYear} onChange={(range) => { setEndDate(range.start); toggleEndDatePopover(); }} onMonthChange={(month, year) => setEndMonthYear({endMonth: month, endYear: year})} selected={endDate} />
                            </Popover>
                            <input type="hidden" name="startDate" value={formatDate(startDate)} />
                            <input type="hidden" name="endDate" value={formatDate(endDate)} />
                            <Button submit variant="primary" loading={isLoading}>Filter</Button>
                        </InlineStack>
                    </Form>
                </InlineStack>
                
                {isLoading ? (
                    <Box style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '150px' }}>
                        <Spinner accessibilityLabel="Loading analytics" size="large" />
                    </Box>
                ) : (
                    <Grid>
                        <Grid.Cell columnSpan={{xs: 6, sm: 3, md: 3, lg: 3, xl: 3}}>
                            <BlockStack gap="200">
                                <Text as="h3" variant="headingSm" tone="subdued">Total Net Profit/Loss</Text>
                                <Text as="p" variant="headingXl" tone={analytics.totalNetProfitLoss < 0 ? "critical" : "success"}>
                                    {analytics.totalNetProfitLoss < 0 ? `-$${Math.abs(analytics.totalNetProfitLoss).toFixed(2)}` : `$${parseFloat(analytics.totalNetProfitLoss).toFixed(2)}`}
                                </Text>
                            </BlockStack>
                        </Grid.Cell>
                        <Grid.Cell columnSpan={{xs: 6, sm: 3, md: 3, lg: 3, xl: 3}}>
                            <BlockStack gap="200">
                                <Text as="h3" variant="headingSm" tone="subdued">Total Returns Tracked</Text>
                                <Text as="p" variant="headingXl">{analytics.totalReturns}</Text>
                            </BlockStack>
                        </Grid.Cell>
                        <Grid.Cell columnSpan={{xs: 6, sm: 3, md: 3, lg: 3, xl: 3}}>
                            <BlockStack gap="200">
                                <Text as="h3" variant="headingSm" tone="subdued">Most Frequent Reason</Text>
                                <Text as="p" variant="headingXl">{analytics.mostFrequentReason}</Text>
                            </BlockStack>
                        </Grid.Cell>
                        <Grid.Cell columnSpan={{xs: 6, sm: 3, md: 3, lg: 3, xl: 3}}>
                            <BlockStack gap="200">
                                <Text as="h3" variant="headingSm" tone="subdued">Resellable Rate</Text>
                                <Text as="p" variant="headingXl">{analytics.resellableRate}%</Text>
                            </BlockStack>
                        </Grid.Cell>
                    </Grid>
                )}
            </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="500">
            <Box>
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingLg" as="h2">ProfitGuard Returns Calculator</Text>
                <Link to="/app/history" style={{ textDecoration: 'none' }}>
                    <Button>View History</Button>
                </Link>
              </InlineStack>
            </Box>
            <p>Enter an order number to calculate the potential profit or loss of a return.</p>
            <Form method="post">
              <input type="hidden" name="intent" value="lookupOrder" />
              <BlockStack gap="200">
                <TextField
                  label="Order Number"
                  name="orderNumber"
                  value={orderNumber}
                  onChange={handleOrderNumberChange}
                  placeholder="Ex: 1001"
                  autoComplete="off"
                />
                <Button submit={true} variant="primary" loading={navigation.state === 'submitting' && navigation.formData?.get('intent') === 'lookupOrder'}>Look Up Order</Button>
              </BlockStack>
            </Form>
          </BlockStack>
        </Card>
        {error && <Banner tone="critical" title="Error"><p>{error}</p></Banner>}
        {order && (
          <Card>
            <Form method="post">
              <input type="hidden" name="intent" value="calculateReturn" />
              <input type="hidden" name="orderData" value={JSON.stringify(order)} />
              <input type="hidden" name="lineItemsData" value={JSON.stringify(simplifiedLineItems)} />
              <BlockStack gap="400">
                <Text variant="headingMd" as="h3">Order {order.name}</Text>
                <BlockStack gap="200">
                  <Text as="p" fontWeight="semibold">Which items are being returned?</Text>
                  {simplifiedLineItems.map((item) => (
                    <Checkbox
                      key={item.id}
                      label={`${item.title} - Price: $${parseFloat(item.price).toFixed(2)}, Cost: $${parseFloat(item.cost).toFixed(2)}`}
                      name="returnedItems"
                      value={item.id}
                      checked={checkedItems.includes(item.id)}
                      onChange={() => handleCheckboxChange(item.id)}
                    />
                  ))}
                </BlockStack>
                <FormLayout>
                  <FormLayout.Group condensed>
                    <Select
                      label="Reason for Return"
                      name="returnReason"
                      options={reasonOptions}
                      onChange={handleReasonChange}
                      value={returnReason}
                    />
                    <Select
                      label="Product Condition"
                      name="productCondition"
                      options={conditionOptions}
                      onChange={handleConditionChange}
                      value={productCondition}
                    />
                  </FormLayout.Group>
                  <FormLayout.Group condensed>
                    <TextField
                      label="Return Shipping Cost"
                      name="returnShippingCost"
                      value={shippingCost}
                      onChange={handleShippingChange}
                      type="number"
                      prefix="$"
                      autoComplete="off"
                    />
                    <TextField
                      label="Internal Handling Fee"
                      name="handlingFee"
                      value={handlingFee}
                      onChange={handleHandlingChange}
                      type="number"
                      prefix="$"
                      autoComplete="off"
                    />
                  </FormLayout.Group>
                </FormLayout>
                <InlineStack gap="200">
                    <Button submit={true} variant="primary" tone="success" loading={navigation.state === 'submitting' && navigation.formData?.get('intent') === 'calculateReturn'}>Calculate Return Profit</Button>
                    <Button onClick={handleResetForm}>Reset Form</Button>
                </InlineStack>
                <Box paddingTop="200">
                    <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                        <i>Disclaimer: All calculations and suggestions are for informational purposes only.</i>
                    </Text>
                </Box>
              </BlockStack>
            </Form>
          </Card>
        )}
        {result && (
          <Banner title="Return Analysis Summary" tone={result.suggestionTone}>
            <BlockStack gap="400">
              <BlockStack gap="200" inlineAlign="center">
                <Text as="h3" variant="headingMd" tone="subdued">Immediate Cash Outlay</Text>
                <Text as="p" variant="heading2xl" tone="critical">${result.immediateCashOutlay}</Text>
                <Text as="p" tone="subdued">(Total Refund + Return Processing Costs)</Text>
              </BlockStack>
              
              <Divider />

              <BlockStack gap="300">
                <BlockStack gap="200" inlineAlign="center">
                  <Text as="h3" variant="headingMd" tone="subdued">True Cost of this Return</Text>
                  <Text as="p" variant="headingXl" tone={result.isResellable ? 'info' : 'critical'}>
                    ${result.netImpact}
                  </Text>
                  <Text as="p" variant="bodyLg">
                    This is the final cost after accounting for inventory value.
                  </Text>
                </BlockStack>

                <Card>
                    <BlockStack gap="200">
                        <Text as="p" tone="subdued">Financial Breakdown:</Text>
                        <Box paddingLeft="200">
                            <BlockStack gap="100">
                                <Text as="p">Total Refund Issued: <Text as="span" tone="critical">-${result.totalRefund}</Text></Text>
                                <Text as="p">Return Processing Costs: <Text as="span" tone="critical">-${result.processingCosts}</Text></Text>
                                {result.isResellable ? (
                                    <Text as="p">Inventory Value: <Text as="span" tone="success">Recovered (Item can be resold)</Text></Text>
                                ) : (
                                    <Text as="p">Cost of Lost Inventory: <Text as="span" tone="critical">-${result.inventoryValueLost}</Text></Text>
                                )}
                            </BlockStack>
                        </Box>
                    </BlockStack>
                </Card>
              </BlockStack>

              <InlineStack align="end" blockAlign="center">
                {returnSaved ? (
                  <Banner tone="success" onDismiss={() => {}}>
                    <p>Return analysis has been saved to your history.</p>
                  </Banner>
                ) : (
                  <Button onClick={handleOpenModal} variant="primary" loading={isSaving}>Save Return Analysis</Button>
                )}
              </InlineStack>
              
              <Banner title="Strategic Suggestion" tone={result.suggestionTone}>
                <Text as="p" variant="bodyLg">{result.suggestion}</Text>
              </Banner>
            </BlockStack>
          </Banner>
        )}
      </BlockStack>
    </Page>
  );
}