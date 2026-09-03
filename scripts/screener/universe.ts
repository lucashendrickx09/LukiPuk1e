// Screener universe.
//
// Sized and balanced so that every Yahoo sector clears the 8-peer minimum from
// the spec — below that, percentiles fall back to the whole universe and the
// company is flagged, which is a worse card. Yahoo assigns the real sector at
// fetch time; the grouping here is only to keep the list balanced by hand.

export const UNIVERSE: string[] = [
  // Technology
  'AAPL', 'MSFT', 'NVDA', 'AVGO', 'AMD', 'ORCL', 'CRM', 'ADBE', 'CSCO', 'ACN',
  'TXN', 'QCOM', 'INTC', 'AMAT', 'LRCX', 'KLAC', 'MU', 'ADI', 'NOW', 'INTU',
  'PANW', 'CRWD', 'SNOW', 'PLTR', 'ARM', 'ASML', 'TSM', 'IBM', 'DELL', 'HPQ',
  // Communication Services
  'GOOGL', 'META', 'NFLX', 'DIS', 'CMCSA', 'TMUS', 'VZ', 'T', 'EA', 'WBD',
  // Consumer Cyclical
  'AMZN', 'TSLA', 'HD', 'MCD', 'NKE', 'SBUX', 'LOW', 'BKNG', 'TJX', 'GM',
  'F', 'CMG', 'ORLY', 'MAR',
  // Consumer Defensive
  'WMT', 'COST', 'PG', 'KO', 'PEP', 'PM', 'MO', 'MDLZ', 'CL', 'KMB',
  'GIS', 'KHC',
  // Healthcare
  'LLY', 'UNH', 'JNJ', 'ABBV', 'MRK', 'PFE', 'TMO', 'ABT', 'DHR', 'AMGN',
  'BMY', 'GILD', 'CVS', 'MDT', 'ISRG', 'VRTX', 'REGN', 'ZTS',
  // Financial Services
  'BRK-B', 'JPM', 'V', 'MA', 'BAC', 'WFC', 'GS', 'MS', 'AXP', 'SCHW',
  'BLK', 'C', 'SPGI', 'CB', 'PGR', 'PYPL',
  // Industrials
  'GE', 'CAT', 'RTX', 'HON', 'UNP', 'BA', 'LMT', 'DE', 'UPS', 'ETN',
  'ADP', 'MMM', 'NOC', 'GD', 'CSX', 'EMR',
  // Energy
  'XOM', 'CVX', 'COP', 'SLB', 'EOG', 'PSX', 'MPC', 'VLO', 'OXY', 'WMB',
  'KMI', 'HAL',
  // Basic Materials
  'LIN', 'SHW', 'APD', 'ECL', 'FCX', 'NEM', 'DOW', 'NUE', 'PPG', 'VMC',
  'MLM', 'ALB',
  // Utilities
  'NEE', 'SO', 'DUK', 'SRE', 'AEP', 'D', 'EXC', 'XEL', 'ED', 'PEG',
  'WEC', 'ES',
  // Real Estate
  'PLD', 'AMT', 'EQIX', 'CCI', 'SPG', 'PSA', 'O', 'WELL', 'DLR', 'VICI',
  'AVB', 'EQR',
];
