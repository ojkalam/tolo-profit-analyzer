/* eslint-disable eslint-comments/disable-enable-pair */
/* eslint-disable eslint-comments/no-unlimited-disable */
/* eslint-disable */
import type * as AdminTypes from './admin.types.js';

export type PopulateProductMutationVariables = AdminTypes.Exact<{
  product: AdminTypes.ProductCreateInput;
}>;


export type PopulateProductMutation = { productCreate?: AdminTypes.Maybe<{ product?: AdminTypes.Maybe<(
      Pick<AdminTypes.Product, 'id' | 'title' | 'handle' | 'status'>
      & { variants: { edges: Array<{ node: Pick<AdminTypes.ProductVariant, 'id' | 'price' | 'barcode' | 'createdAt'> }> } }
    )> }> };

export type ShopifyReactRouterTemplateUpdateVariantMutationVariables = AdminTypes.Exact<{
  productId: AdminTypes.Scalars['ID']['input'];
  variants: Array<AdminTypes.ProductVariantsBulkInput> | AdminTypes.ProductVariantsBulkInput;
}>;


export type ShopifyReactRouterTemplateUpdateVariantMutation = { productVariantsBulkUpdate?: AdminTypes.Maybe<{ productVariants?: AdminTypes.Maybe<Array<Pick<AdminTypes.ProductVariant, 'id' | 'price' | 'barcode' | 'createdAt'>>> }> };

export type ToloBulkImportStartMutationVariables = AdminTypes.Exact<{
  query: AdminTypes.Scalars['String']['input'];
}>;


export type ToloBulkImportStartMutation = { bulkOperationRunQuery?: AdminTypes.Maybe<{ bulkOperation?: AdminTypes.Maybe<Pick<AdminTypes.BulkOperation, 'id' | 'status'>>, userErrors: Array<Pick<AdminTypes.BulkOperationUserError, 'field' | 'message'>> }> };

export type ToloBulkImportPollQueryVariables = AdminTypes.Exact<{
  id: AdminTypes.Scalars['ID']['input'];
}>;


export type ToloBulkImportPollQuery = { node?: AdminTypes.Maybe<Pick<AdminTypes.BulkOperation, 'id' | 'status' | 'errorCode' | 'objectCount' | 'url'>> };

export type ToloVariantFieldsFragment = (
  Pick<AdminTypes.ProductVariant, 'id' | 'title' | 'sku' | 'price'>
  & { inventoryItem: (
    Pick<AdminTypes.InventoryItem, 'id'>
    & { unitCost?: AdminTypes.Maybe<Pick<AdminTypes.MoneyV2, 'amount'>>, measurement: { weight?: AdminTypes.Maybe<Pick<AdminTypes.Weight, 'unit' | 'value'>> } }
  ) }
);

export type ToloCatalogSyncQueryVariables = AdminTypes.Exact<{
  cursor?: AdminTypes.InputMaybe<AdminTypes.Scalars['String']['input']>;
}>;


export type ToloCatalogSyncQuery = { products: { pageInfo: Pick<AdminTypes.PageInfo, 'hasNextPage' | 'endCursor'>, nodes: Array<(
      Pick<AdminTypes.Product, 'id' | 'title' | 'status'>
      & { variants: { nodes: Array<(
          Pick<AdminTypes.ProductVariant, 'id' | 'title' | 'sku' | 'price'>
          & { inventoryItem: (
            Pick<AdminTypes.InventoryItem, 'id'>
            & { unitCost?: AdminTypes.Maybe<Pick<AdminTypes.MoneyV2, 'amount'>>, measurement: { weight?: AdminTypes.Maybe<Pick<AdminTypes.Weight, 'unit' | 'value'>> } }
          ) }
        )> } }
    )> } };

export type ToloProductSyncQueryVariables = AdminTypes.Exact<{
  id: AdminTypes.Scalars['ID']['input'];
}>;


export type ToloProductSyncQuery = { product?: AdminTypes.Maybe<(
    Pick<AdminTypes.Product, 'id' | 'title' | 'status'>
    & { variants: { nodes: Array<(
        Pick<AdminTypes.ProductVariant, 'id' | 'title' | 'sku' | 'price'>
        & { inventoryItem: (
          Pick<AdminTypes.InventoryItem, 'id'>
          & { unitCost?: AdminTypes.Maybe<Pick<AdminTypes.MoneyV2, 'amount'>>, measurement: { weight?: AdminTypes.Maybe<Pick<AdminTypes.Weight, 'unit' | 'value'>> } }
        ) }
      )> } }
  )> };

export type ToloOrderSyncQueryVariables = AdminTypes.Exact<{
  id: AdminTypes.Scalars['ID']['input'];
}>;


export type ToloOrderSyncQuery = { order?: AdminTypes.Maybe<(
    Pick<AdminTypes.Order, 'id' | 'name' | 'processedAt' | 'cancelledAt' | 'test' | 'currencyCode' | 'totalWeight' | 'discountCodes'>
    & { shippingAddress?: AdminTypes.Maybe<Pick<AdminTypes.MailingAddress, 'countryCodeV2'>>, totalDiscountsSet?: AdminTypes.Maybe<{ shopMoney: Pick<AdminTypes.MoneyV2, 'amount'> }>, totalShippingPriceSet: { shopMoney: Pick<AdminTypes.MoneyV2, 'amount'> }, totalRefundedSet: { shopMoney: Pick<AdminTypes.MoneyV2, 'amount'> }, lineItems: { nodes: Array<(
        Pick<AdminTypes.LineItem, 'id' | 'title' | 'quantity'>
        & { product?: AdminTypes.Maybe<Pick<AdminTypes.Product, 'id'>>, variant?: AdminTypes.Maybe<Pick<AdminTypes.ProductVariant, 'id'>>, originalTotalSet: { shopMoney: Pick<AdminTypes.MoneyV2, 'amount'> }, discountAllocations: Array<{ allocatedAmountSet: { shopMoney: Pick<AdminTypes.MoneyV2, 'amount'> } }> }
      )> }, refunds: Array<(
      Pick<AdminTypes.Refund, 'id'>
      & { totalRefundedSet: { shopMoney: Pick<AdminTypes.MoneyV2, 'amount'> }, refundLineItems: { nodes: Array<(
          Pick<AdminTypes.RefundLineItem, 'quantity'>
          & { subtotalSet: { shopMoney: Pick<AdminTypes.MoneyV2, 'amount'> }, lineItem: Pick<AdminTypes.LineItem, 'id'> }
        )> } }
    )> }
  )> };

export type ToloReconcileOrdersQueryVariables = AdminTypes.Exact<{
  query: AdminTypes.Scalars['String']['input'];
  cursor?: AdminTypes.InputMaybe<AdminTypes.Scalars['String']['input']>;
}>;


export type ToloReconcileOrdersQuery = { orders: { pageInfo: Pick<AdminTypes.PageInfo, 'hasNextPage' | 'endCursor'>, nodes: Array<Pick<AdminTypes.Order, 'id'>> } };

export type ToloShopInfoQueryVariables = AdminTypes.Exact<{ [key: string]: never; }>;


export type ToloShopInfoQuery = { shop: Pick<AdminTypes.Shop, 'name' | 'currencyCode' | 'ianaTimezone'> };

interface GeneratedQueryTypes {
  "#graphql\n  query ToloBulkImportPoll($id: ID!) {\n    node(id: $id) {\n      ... on BulkOperation {\n        id\n        status\n        errorCode\n        objectCount\n        url\n      }\n    }\n  }\n": {return: ToloBulkImportPollQuery, variables: ToloBulkImportPollQueryVariables},
  "#graphql\n  query ToloCatalogSync($cursor: String) {\n    products(first: 50, after: $cursor) {\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n      nodes {\n        id\n        title\n        status\n        variants(first: 100) {\n          nodes {\n            ...ToloVariantFields\n          }\n        }\n      }\n    }\n  }\n  #graphql\n  fragment ToloVariantFields on ProductVariant {\n    id\n    title\n    sku\n    price\n    inventoryItem {\n      id\n      unitCost {\n        amount\n      }\n      measurement {\n        weight {\n          unit\n          value\n        }\n      }\n    }\n  }\n\n": {return: ToloCatalogSyncQuery, variables: ToloCatalogSyncQueryVariables},
  "#graphql\n  query ToloProductSync($id: ID!) {\n    product(id: $id) {\n      id\n      title\n      status\n      variants(first: 100) {\n        nodes {\n          ...ToloVariantFields\n        }\n      }\n    }\n  }\n  #graphql\n  fragment ToloVariantFields on ProductVariant {\n    id\n    title\n    sku\n    price\n    inventoryItem {\n      id\n      unitCost {\n        amount\n      }\n      measurement {\n        weight {\n          unit\n          value\n        }\n      }\n    }\n  }\n\n": {return: ToloProductSyncQuery, variables: ToloProductSyncQueryVariables},
  "#graphql\n  query ToloOrderSync($id: ID!) {\n    order: node(id: $id) {\n      ... on Order {\n        id\n        name\n        processedAt\n        cancelledAt\n        test\n        currencyCode\n        totalWeight\n        shippingAddress {\n          countryCodeV2\n        }\n        discountCodes\n        totalDiscountsSet {\n          shopMoney {\n            amount\n          }\n        }\n        totalShippingPriceSet {\n          shopMoney {\n            amount\n          }\n        }\n        totalRefundedSet {\n          shopMoney {\n            amount\n          }\n        }\n        lineItems(first: 100) {\n          nodes {\n            id\n            title\n            quantity\n            product {\n              id\n            }\n            variant {\n              id\n            }\n            originalTotalSet {\n              shopMoney {\n                amount\n              }\n            }\n            discountAllocations {\n              allocatedAmountSet {\n                shopMoney {\n                  amount\n                }\n              }\n            }\n          }\n        }\n        refunds(first: 60) {\n          id\n          totalRefundedSet {\n            shopMoney {\n              amount\n            }\n          }\n          refundLineItems(first: 100) {\n            nodes {\n              quantity\n              subtotalSet {\n                shopMoney {\n                  amount\n                }\n              }\n              lineItem {\n                id\n              }\n            }\n          }\n        }\n      }\n    }\n  }\n": {return: ToloOrderSyncQuery, variables: ToloOrderSyncQueryVariables},
  "#graphql\n  query ToloReconcileOrders($query: String!, $cursor: String) {\n    orders(first: 100, after: $cursor, query: $query) {\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n      nodes {\n        id\n      }\n    }\n  }\n": {return: ToloReconcileOrdersQuery, variables: ToloReconcileOrdersQueryVariables},
  "#graphql\n  query ToloShopInfo {\n    shop {\n      name\n      currencyCode\n      ianaTimezone\n    }\n  }\n": {return: ToloShopInfoQuery, variables: ToloShopInfoQueryVariables},
}

interface GeneratedMutationTypes {
  "#graphql\n      mutation populateProduct($product: ProductCreateInput!) {\n        productCreate(product: $product) {\n          product {\n            id\n            title\n            handle\n            status\n            variants(first: 10) {\n              edges {\n                node {\n                  id\n                  price\n                  barcode\n                  createdAt\n                }\n              }\n            }\n          }\n        }\n      }": {return: PopulateProductMutation, variables: PopulateProductMutationVariables},
  "#graphql\n    mutation shopifyReactRouterTemplateUpdateVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {\n      productVariantsBulkUpdate(productId: $productId, variants: $variants) {\n        productVariants {\n          id\n          price\n          barcode\n          createdAt\n        }\n      }\n    }": {return: ShopifyReactRouterTemplateUpdateVariantMutation, variables: ShopifyReactRouterTemplateUpdateVariantMutationVariables},
  "#graphql\n  mutation ToloBulkImportStart($query: String!) {\n    bulkOperationRunQuery(query: $query) {\n      bulkOperation {\n        id\n        status\n      }\n      userErrors {\n        field\n        message\n      }\n    }\n  }\n": {return: ToloBulkImportStartMutation, variables: ToloBulkImportStartMutationVariables},
}
declare module '@shopify/admin-api-client' {
  type InputMaybe<T> = AdminTypes.InputMaybe<T>;
  interface AdminQueries extends GeneratedQueryTypes {}
  interface AdminMutations extends GeneratedMutationTypes {}
}
