"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  Check,
  CircleCheck,
  LayoutGrid,
  PackageSearch,
  RotateCcw,
  Search,
  ShoppingBag,
} from "lucide-react";
import { useCart } from "@/components/cart-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import type {
  GetAllCategoriesResult,
  ProductDetailsResult,
  ProductSummary,
  ReturnOrderResult,
  SearchProductsResult,
} from "@/lib/agent-types";
import type { ShoppingAgentUIMessage } from "@/lib/agent";
import { formatPrice } from "@/lib/format";
import type { StockInfo } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  ToolErrorNotice,
  ToolFailureNotice,
  ToolProgress,
} from "./chat-status";

type ShoppingPart = ShoppingAgentUIMessage["parts"][number];

/** Close the mobile chat sheet when a link navigates to a store page. */
function useCloseOnMobile() {
  const { isMobile, setOpenMobile } = useSidebar();
  return () => {
    if (isMobile) setOpenMobile(false);
  };
}

// ---------------------------------------------------------------------------
// Product search results
// ---------------------------------------------------------------------------

const INITIAL_VISIBLE = 6;

function ProductTile({ product }: { product: ProductSummary }) {
  const closeOnMobile = useCloseOnMobile();
  return (
    <li className="min-w-0">
      <Link
        href={`/products/${product.slug}`}
        onClick={closeOnMobile}
        className="group block h-full overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="relative aspect-square overflow-hidden bg-secondary">
          {product.image ? (
            <Image
              src={product.image}
              alt=""
              fill
              sizes="(min-width: 640px) 200px, 45vw"
              className="object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <ShoppingBag
              className="absolute inset-0 m-auto size-8 text-muted-foreground"
              aria-hidden="true"
            />
          )}
        </div>
        <div className="space-y-0.5 p-2.5">
          <p className="line-clamp-2 text-xs font-medium leading-snug">
            {product.name}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatPrice(product.price, product.currency)}
          </p>
        </div>
      </Link>
    </li>
  );
}

function ProductResults({
  result,
}: {
  result: Extract<SearchProductsResult, { ok: true }>;
}) {
  const [expanded, setExpanded] = useState(false);
  const closeOnMobile = useCloseOnMobile();
  const { products } = result;

  const label = [
    result.query && `“${result.query}”`,
    result.category && `in ${result.category}`,
  ]
    .filter(Boolean)
    .join(" ");

  if (products.length === 0) {
    return (
      <ToolFailureNotice
        title="No matching products"
        failure={{
          code: "NOT_FOUND",
          message: label
            ? `Nothing in the catalog matched ${label}.`
            : "The catalog returned no products.",
        }}
      />
    );
  }

  const visible = expanded ? products : products.slice(0, INITIAL_VISIBLE);
  const searchParams = new URLSearchParams();
  if (result.query) searchParams.set("q", result.query);
  if (result.category) searchParams.set("category", result.category);

  return (
    <section aria-label={`Product results ${label}`.trim()} className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {products.length} product{products.length === 1 ? "" : "s"}
        {label ? ` ${label}` : ""}
      </p>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {visible.map((product) => (
          <ProductTile key={product.id} product={product} />
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        {products.length > INITIAL_VISIBLE && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            {expanded
              ? "Show fewer"
              : `Show ${products.length - INITIAL_VISIBLE} more`}
          </Button>
        )}
        <Button asChild variant="link" size="sm" className="px-0">
          <Link
            href={`/search${searchParams.size ? `?${searchParams}` : ""}`}
            onClick={closeOnMobile}
          >
            Open in search <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Product details
// ---------------------------------------------------------------------------

function StockBadge({ stock }: { stock: StockInfo | null }) {
  if (!stock) {
    return <Badge variant="outline">Availability unknown</Badge>;
  }
  if (!stock.inStock) {
    return <Badge variant="destructive">Out of stock</Badge>;
  }
  if (stock.lowStock) {
    return (
      <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400">
        Only {stock.stock} left
      </Badge>
    );
  }
  return (
    <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
      In stock
    </Badge>
  );
}

function ProductDetailCard({
  result,
}: {
  result: Extract<ProductDetailsResult, { ok: true }>;
}) {
  const { product, stock } = result;
  const { addToCart, openCart } = useCart();
  const closeOnMobile = useCloseOnMobile();
  const [imageIndex, setImageIndex] = useState(0);
  const [added, setAdded] = useState(false);
  const image = product.images[imageIndex] ?? product.images[0];
  const canBuy = stock?.inStock !== false;

  return (
    <article
      aria-label={product.name}
      className="overflow-hidden rounded-lg border border-border bg-card"
    >
      <div className="relative aspect-[4/3] bg-secondary">
        {image && (
          <Image
            src={image}
            alt={product.name}
            fill
            sizes="(min-width: 640px) 420px, 90vw"
            className="object-cover"
          />
        )}
      </div>
      {product.images.length > 1 && (
        <div className="flex gap-1.5 px-3 pt-3" role="group" aria-label="Product images">
          {product.images.map((src, index) => (
            <button
              key={src}
              type="button"
              onClick={() => setImageIndex(index)}
              aria-label={`Show image ${index + 1}`}
              aria-pressed={index === imageIndex}
              className={cn(
                "relative size-11 overflow-hidden rounded-md border",
                index === imageIndex ? "border-foreground" : "border-border",
              )}
            >
              <Image src={src} alt="" fill sizes="44px" className="object-cover" />
            </button>
          ))}
        </div>
      )}
      <div className="space-y-3 p-3">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold leading-snug">{product.name}</h3>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm">
              {formatPrice(product.price, product.currency)}
            </span>
            <StockBadge stock={stock} />
          </div>
        </div>
        <p className="text-sm text-muted-foreground">{product.description}</p>
        <dl className="flex flex-wrap gap-1.5 text-xs">
          <dt className="sr-only">Category</dt>
          <dd>
            <Badge variant="secondary">{product.category}</Badge>
          </dd>
          {product.tags.length > 0 && <dt className="sr-only">Tags</dt>}
          {product.tags.slice(0, 5).map((tag) => (
            <dd key={tag}>
              <Badge variant="outline">{tag}</Badge>
            </dd>
          ))}
        </dl>
        <div className="flex flex-wrap gap-2">
          {added ? (
            <Button type="button" size="sm" variant="secondary" onClick={openCart}>
              <Check className="size-3.5" aria-hidden="true" />
              Added — view cart
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              disabled={!canBuy}
              onClick={() => {
                addToCart(product, 1);
                setAdded(true);
              }}
            >
              <ShoppingBag className="size-3.5" aria-hidden="true" />
              {canBuy ? "Add to cart" : "Out of stock"}
            </Button>
          )}
          <Button asChild size="sm" variant="outline">
            <Link href={`/products/${product.slug}`} onClick={closeOnMobile}>
              View product page
            </Link>
          </Button>
        </div>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

function CategoryChips({
  result,
}: {
  result: Extract<GetAllCategoriesResult, { ok: true }>;
}) {
  const closeOnMobile = useCloseOnMobile();
  return (
    <nav aria-label="Store categories">
      <ul className="flex flex-wrap gap-1.5">
        {result.categories.map((category) => (
          <li key={category.slug}>
            <Link
              href={`/search?category=${encodeURIComponent(category.slug)}`}
              onClick={closeOnMobile}
              className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {category.name}
              <span className="text-muted-foreground">{category.productCount}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Returns
// ---------------------------------------------------------------------------

function ReturnFiledCard({
  result,
}: {
  result: Extract<ReturnOrderResult, { ok: true }>;
}) {
  return (
    <article
      aria-label={`Return filed for order ${result.orderId}`}
      className="space-y-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm"
    >
      <div className="flex items-center gap-2">
        <CircleCheck
          className="size-4 text-emerald-600 dark:text-emerald-400"
          aria-hidden="true"
        />
        <h3 className="font-semibold">Return filed for order #{result.orderId}</h3>
      </div>
      <ul className="space-y-1">
        {result.items.map((item) => (
          <li key={item.productId} className="flex justify-between gap-3">
            <span className="min-w-0 truncate">
              {item.name} × {item.quantity}
            </span>
            <span className="shrink-0 text-muted-foreground">
              {formatPrice(item.lineTotal, result.currency)}
            </span>
          </li>
        ))}
      </ul>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <dt>Order total</dt>
        <dd>{formatPrice(result.refundEstimate, result.currency)}</dd>
        <dt>Reason</dt>
        <dd className="break-words">{result.reason}</dd>
        <dt>Reference</dt>
        <dd className="font-mono">{result.returnRunId.slice(-10)}</dd>
      </dl>
      <p className="text-xs text-muted-foreground">
        We&apos;re notifying you by email, pre-authorizing your refund and
        submitting the return now. You&apos;ll get another email with the
        store&apos;s decision.
      </p>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Part renderer
// ---------------------------------------------------------------------------

export function ShoppingToolPart({ part }: { part: ShoppingPart }) {
  switch (part.type) {
    case "tool-searchProducts": {
      const query = part.input?.query;
      const category = part.input?.category;
      if (part.state === "input-streaming" || part.state === "input-available") {
        return (
          <ToolProgress
            icon={<Search className="size-4" />}
            label={
              query
                ? `Searching for “${query}”…`
                : category
                  ? `Browsing ${category}…`
                  : "Browsing the catalog…"
            }
          />
        );
      }
      if (part.state === "output-error") {
        return <ToolErrorNotice label="Product search" errorText={part.errorText} />;
      }
      if (part.state === "output-available") {
        return part.output.ok ? (
          <ProductResults result={part.output} />
        ) : (
          <ToolFailureNotice failure={part.output} />
        );
      }
      return null;
    }

    case "tool-getAllCategories": {
      if (part.state === "input-streaming" || part.state === "input-available") {
        return (
          <ToolProgress icon={<LayoutGrid className="size-4" />} label="Loading categories…" />
        );
      }
      if (part.state === "output-error") {
        return <ToolErrorNotice label="Loading categories" errorText={part.errorText} />;
      }
      if (part.state === "output-available") {
        return part.output.ok ? (
          <CategoryChips result={part.output} />
        ) : (
          <ToolFailureNotice failure={part.output} />
        );
      }
      return null;
    }

    case "tool-getProductDetails": {
      if (part.state === "input-streaming" || part.state === "input-available") {
        return (
          <ToolProgress
            icon={<PackageSearch className="size-4" />}
            label="Looking up product details…"
          />
        );
      }
      if (part.state === "output-error") {
        return <ToolErrorNotice label="Product lookup" errorText={part.errorText} />;
      }
      if (part.state === "output-available") {
        return part.output.ok ? (
          <ProductDetailCard result={part.output} />
        ) : (
          <ToolFailureNotice title="Product not found" failure={part.output} />
        );
      }
      return null;
    }

    case "tool-returnOrder": {
      if (part.state === "input-streaming" || part.state === "input-available") {
        return (
          <ToolProgress
            icon={<RotateCcw className="size-4" />}
            label={
              part.input?.orderId
                ? `Filing a return for order #${part.input.orderId}…`
                : "Filing your return…"
            }
          />
        );
      }
      if (part.state === "output-error") {
        return <ToolErrorNotice label="Filing the return" errorText={part.errorText} />;
      }
      if (part.state === "output-available") {
        return part.output.ok ? (
          <ReturnFiledCard result={part.output} />
        ) : (
          <ToolFailureNotice
            title={
              part.output.code === "NOT_FOUND"
                ? "Order not found"
                : part.output.code === "NOT_ELIGIBLE"
                  ? "This order can't be returned"
                  : part.output.code === "ALREADY_IN_PROGRESS"
                    ? "Return already in progress"
                    : "Return not filed"
            }
            failure={part.output}
          />
        );
      }
      return null;
    }

    default:
      return null;
  }
}
