// netlify/functions/quote.js
// Kingdom Impact Holdings LLC — KIHLLC-Pro7
// Proxies Twelve Data API — key stays server-side, browser never sees it.

const TWELVE_DATA_KEY = '41c1cac9621c433cbbcb73c1b4bb33e2';
const BASE_URL = 'https://api.twelvedata.com';

const TF_MAP = {
  '1m':'1min','5m':'5min','15m':'15min','30m':'30min',
  '1h':'1h','4h':'4h','1d':'1day','1w':'1week','1mo':'1month',
};

function normalizeTicker(tk) {
  const map = {
    'GC=F':'XAU/USD','SI=F':'XAG/USD','CL=F':'WTI/USD','BZ=F':'BRENT/USD',
    'NG=F':'NATGAS/USD','DX-Y.NYB':'DXY','^VIX':'VIX','^GSPC':'SPX',
    '^DJI':'DJI','^IXIC':'IXIC','^RUT':'RUT','^TNX':'US10Y',
    'EURUSD=X':'EUR/USD','GBPUSD=X':'GBP/USD','USDJPY=X':'USD/JPY',
    'AUDUSD=X':'AUD/USD','USDCAD=X':'USD/CAD','USDCHF=X':'USD/CHF',
    'NZDUSD=X':'NZD/USD','EURGBP=X':'EUR/GBP','EURJPY=X':'EUR/JPY',
    'GBPJPY=X':'GBP/JPY','AUDJPY=X':'AUD/JPY','CADJPY=X':'CAD/JPY',
    'CHFJPY=X':'CHF/JPY','EURCHF=X':'EUR/CHF','EURAUD=X':'EUR/AUD',
    'EURCAD=X':'EUR/CAD','GBPAUD=X':'GBP/AUD','GBPCAD=X':'GBP/CAD',
    'AUDCAD=X':'AUD/CAD','AUDNZD=X':'AUD/NZD','NZDCAD=X':'NZD/CAD',
    'USDZAR=X':'USD/ZAR','USDMXN=X':'USD/MXN','USDSEK=X':'USD/SEK',
    'USDNOK=X':'USD/NOK','USDDKK=X':'USD/DKK','USDSGD=X':'USD/SGD',
    'USDHKD=X':'USD/HKD','BTC-USD':'BTC/USD','ETH-USD':'ETH/USD',
    'BNB-USD':'BNB/USD','SOL-USD':'SOL/USD','XRP-USD':'XRP/USD',
    'ADA-USD':'ADA/USD','DOGE-USD':'DOGE/USD','LTC-USD':'LTC/USD',
    'AVAX-USD':'AVAX/USD','DOT-USD':'DOT/USD','LINK-USD':'LINK/USD',
    'MATIC-USD':'MATIC/USD','ATOM-USD':'ATOM/USD','UNI-USD':'UNI/USD',
    'AAVE-USD':'AAVE/USD','BTC=X':'BTC/USD','ETH=X':'ETH/USD',
  };
  if (map[tk]) return map[tk];
  if (tk.startsWith('^')) return tk.slice(1);
  if (tk.endsWith('=F')) return tk.replace('=F','');
  if (tk.endsWith('=X')) return tk.replace('=X','').replace(/(.{3})(.{3})/,'$1/$2');
  return tk;
}

// In-memory cache per function instance (resets on cold start, ~fine for free tier)
const _cache = new Map();
const CACHE_TTL = 30000; // 30 seconds

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };

  const params   = event.queryStringParameters || {};
  const rawSymbol = params.symbol || 'XAU/USD';
  const tf        = params.tf || '1h';
  const outputsize = Math.min(parseInt(params.outputsize || '120', 10), 500);
  const symbol    = normalizeTicker(rawSymbol);
  const interval  = TF_MAP[tf] || '1h';

  // Cache check
  const cacheKey = `${symbol}|${interval}`;
  const cached = _cache.get(cacheKey);
  if (cached && (Date.now() - cached.ts < CACHE_TTL)) {
    return { statusCode: 200, headers, body: JSON.stringify(cached.data) };
  }

  const url = `${BASE_URL}/time_series`
    + `?symbol=${encodeURIComponent(symbol)}`
    + `&interval=${interval}`
    + `&outputsize=${outputsize}`
    + `&order=ASC`
    + `&apikey=${TWELVE_DATA_KEY}`;

  try {
    const res  = await fetch(url);
    const json = await res.json();

    // Rate limit hit — return friendly error
    if (json.status === 'error') {
      return {
        statusCode: 429,
        headers,
        body: JSON.stringify({ status: 'error', message: json.message, symbol }),
      };
    }

    if (!json.values || !json.values.length) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ status: 'error', message: 'No data returned', symbol }),
      };
    }

    const values    = json.values;
    const timestamps = values.map(v => Math.floor(new Date(v.datetime).getTime() / 1000));
    const open      = values.map(v => parseFloat(v.open));
    const high      = values.map(v => parseFloat(v.high));
    const low       = values.map(v => parseFloat(v.low));
    const close     = values.map(v => parseFloat(v.close));
    const volume    = values.map(v => parseInt(v.volume || '0', 10));
    const lastClose = close[close.length - 1];
    const prevClose = close.length > 1 ? close[close.length - 2] : lastClose;

    const shaped = {
      status: 'ok',
      data: {
        [rawSymbol]: {
          status: 'ok',
          symbol: rawSymbol,
          regularMarketPrice: lastClose,
          chartPreviousClose: prevClose,
          timestamp: timestamps,
          open, high, low, close, volume,
        }
      }
    };

    _cache.set(cacheKey, { data: shaped, ts: Date.now() });
    return { statusCode: 200, headers, body: JSON.stringify(shaped) };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ status: 'error', message: err.message }),
    };
  }
};
