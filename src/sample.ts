/**
 * A clearly fictional sample feed. Every value is synthetic and every link uses
 * the reserved example.invalid domain. It is designed to show each kind of
 * finding: a proposed spelling repair, unresolved facts and a formula risk.
 */
export const SAMPLE_NAME = 'fictional-sample-feed.csv';

export const SAMPLE_CSV = [
  'id,title,price,availability,link,gtin,colour',
  'LL-1001,Studio desk lamp,20.00 USD,In Stock,https://example.invalid/p/ll-1001,04006381333931,Graphite',
  'LL-1002,"Oak shelf, two tiers",120.00 USD,out of stock,https://example.invalid/p/ll-1002,,Natural',
  'LL-1003,Wool throw,45.00 USD,preorder,https://example.invalid/p/ll-1003,12345,Rust',
  'LL-1003,,45.00 USD,in_stock,https://example.invalid/p/ll-1003,,Moss',
  'LL-1005,Ceramic mug set,"1,200",backorder,https://example.invalid/p/ll-1005,,White',
  'LL-1006,Linen napkins,-8.00 USD,in_stock,example.invalid/p/ll-1006,,Sand',
  'LL-1007,Brass wall hook,6.50 USD,available soon,https://example.invalid/p/ll-1007,,',
  'LL-1008,=SUM(A1:A9),9.00 USD,in_stock,https://example.invalid/p/ll-1008,,Note only',
  '',
].join('\n');
