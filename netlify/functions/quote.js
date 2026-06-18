// netlify/functions/quote.js
// Kingdom Impact Holdings LLC — KIHLLC-Pro7
// Proxies requests to Twelve Data API — keeps the API key server-side.

const TWELVE_DATA_KEY = '41c1cac9621c433cbbcb73c1b4bb33e2';
const BASE_URL = 'https://api.twelvedata.com';

// Map our internal TF codes → Twelve Data interval strings
const TF_MAP = {
  '1m': '1min', '5m': '5min', '15m': '15min', '30m': '30min',
  '1h': '1h',   '4h': '4h',   '1d': '1day',   '1w': '1week',
  '1mo': '1month',
};

// Map Yahoo-style tickers → Twelve Data symbols
// Twelve Data uses clean symbols — strip Yahoo suffixes like =F, =X, ^
function normalizeTicker(tk) {
  const map = {
    'GC=F':   'XAU/USD',  // Gold
    'SI=F':   'XAG/USD',  // Silver
    'CL=F':   'WTI/USD',  // Crude Oil
    'BZ=F':   'BRENT/USD',
    'NG=F':   'NATGAS/USD',
    'DX-Y.NYB': 'DXY',
    '^VIX':   'VIX',
    '^GSPC':  'SPX',
    '^DJI':   'DJI',
    '^IXIC':  'IXIC',
    '^RUT':   'RUT',
    '^TNX':   'US10Y',
    '^FVX':   'US05Y',
    '^TYX':   'US30Y',
    'EURUSD=X': 'EUR/USD',
    'GBPUSD=X': 'GBP/USD',
    'USDJPY=X': 'USD/JPY',
    'AUDUSD=X': 'AUD/USD',
    'USDCAD=X': 'USD/CAD',
    'USDCHF=X': 'USD/CHF',
    'NZDUSD=X': 'NZD/USD',
    'EURGBP=X': 'EUR/GBP',
    'EURJPY=X': 'EUR/JPY',
    'GBPJPY=X': 'GBP/JPY',
    'AUDJPY=X': 'AUD/JPY',
    'CADJPY=X': 'CAD/JPY',
    'CHFJPY=X': 'CHF/JPY',
    'EURCHF=X': 'EUR/CHF',
    'EURAUD=X': 'EUR/AUD',
    'EURCAD=X': 'EUR/CAD',
    'GBPAUD=X': 'GBP/AUD',
    'GBPCAD=X': 'GBP/CAD',
    'AUDCAD=X': 'AUD/CAD',
    'AUDNZD=X': 'AUD/NZD',
    'NZDCAD=X': 'NZD/CAD',
    'USDZAR=X': 'USD/ZAR',
    'USDMXN=X': 'USD/MXN',
    'USDSEK=X': 'USD/SEK',
    'USDNOK=X': 'USD/NOK',
    'USDDKK=X': 'USD/DKK',
    'USDSGD=X': 'USD/SGD',
    'USDHKD=X': 'USD/HKD',
    'BTC-USD': 'BTC/USD',
    'ETH-USD': 'ETH/USD',
    'BNB-USD': 'BNB/USD',
    'SOL-USD': 'SOL/USD',
    'XRP-USD': 'XRP/USD',
    'ADA-USD': 'ADA/USD',
    'DOGE-USD': 'DOGE/USD',
    'LTC-USD': 'LTC/USD',
    'AVAX-USD': 'AVAX/USD',
    'DOT-USD': 'DOT/USD',
    'LINK-USD': 'LINK/USD',
    'MATIC-USD': 'MATIC/USD',
    'ATOM-USD': 'ATOM/USD',
    'UNI-USD': 'UNI/USD',
    'AAVE-USD': 'AAVE/USD',
    'BTC=X':  'BTC/USD',
    'ETH=X':  'ETH/USD',
  };
  if (map[tk]) return map[tk];
  // Strip ^ prefix (indices)
  if (tk.startsWith('^')) return tk.slice(1);
  // Strip =F suffix (futures) — already handled above for common ones
  if (tk.endsWith('=F')) return tk.replace('=F', '');
  // Strip =X suffix (forex) — already handled above
  if (tk.endsWith('=X')) return tk.replace('=X', '').replace(/(.{3})(.{3})/, '$1/$2');
  return tk;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  const params = event.queryStringParameters || {};
  const rawSymbol = params.symbol || 'XAU/USD';
  const tf        = params.tf || '1h';
  const outputsize = Math.min(parseInt(params.outputsize || '200', 10), 5000);

  const symbol   = normalizeTicker(rawSymbol);
  const interval = TF_MAP[tf] || '1h';

  const url = `${BASE_URL}/time_series`
    + `?symbol=${encodeURIComponent(symbol)}`
    + `&interval=${interval}`
    + `&outputsize=${outputsize}`
    + `&order=ASC`
    + `&apikey=${TWELVE_DATA_KEY}`;

  try {
    const res  = await fetch(url);
    const json = await res.json();

    if (json.status === 'error' || !json.values) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ status: 'error', message: json.message || 'No data', symbol }),
      };
    }

    // Re-shape into the legacy Yahoo-style structure the app expects
    const values = json.values; // [{datetime, open, high, low, close, volume}]
    const timestamps = values.map(v => Math.floor(new Date(v.datetime).getTime() / 1000));
    const open   = values.map(v => parseFloat(v.open));
    const high   = values.map(v => parseFloat(v.high));
    const low    = values.map(v => parseFloat(v.low));
    const close  = values.map(v => parseFloat(v.close));
    const volume = values.map(v => parseInt(v.volume || '0', 10));

    const lastClose = close[close.length - 1];
    const prevClose = close.length > 1 ? close[close.length - 2] : lastClose;

    const shaped = {
      status: 'ok',
      credits_left: json.meta?.credits_left ?? null,
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

    return { statusCode: 200, headers, body: JSON.stringify(shaped) };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ status: 'error', message: err.message }),
    };
  }
};
