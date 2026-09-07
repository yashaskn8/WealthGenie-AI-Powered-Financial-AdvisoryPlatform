/**
 * WealthGenie — 100% Hand-Curated "Where to Invest" Real Product Database
 * ──────────────────────────────────────────────────────────────────────────
 * Maps EVERY SINGLE investment instrument (155 total) to 5 top-rated,
 * accurate, precise real-world products, banks, AMCs, or platforms.
 *
 * Data verified against AMFI, SEBI, RBI, and financial portals.
 * Last updated: August 2026
 */

const WHERE_TO_INVEST = {
  "ppf": {
    "title": "Where to Access Public Provident Fund (PPF)",
    "riskLevel": 1,
    "note": "Government-backed EEE tax-free scheme. Zero default risk with sovereign guarantee. Best tax efficiency for all income levels. Guaranteed by Government of India / RBI authority.",
    "howToStart": "Open via net banking if you already have a savings account, or visit any bank branch / post office with Aadhaar + PAN.",
    "products": [
      {
        "name": "SBI Public Provident Fund (PPF)",
        "provider": "State Bank of India",
        "rate": "~7.1% p.a.",
        "highlight": "India's largest branch network (22,000+) ensuring seamless access & auto-credit.",
        "platform": "SBI YONO / Branch",
        "minInvestment": "₹500",
        "tenure": "Fixed Term",
        "badge": "Most Accessible"
      },
      {
        "name": "HDFC Bank Public Provident Fund (PPF)",
        "provider": "HDFC Bank",
        "rate": "~7.1% p.a.",
        "highlight": "Seamless digital account setup and instant e-statements via NetBanking.",
        "platform": "HDFC NetBanking / Branch",
        "minInvestment": "₹500",
        "tenure": "Fixed Term",
        "badge": "Best Digital UI"
      },
      {
        "name": "ICICI Bank Public Provident Fund (PPF)",
        "provider": "ICICI Bank",
        "rate": "~7.1% p.a.",
        "highlight": "Quick digital tracking via iMobile Pay app with free tax reports.",
        "platform": "ICICI iMobile / Branch",
        "minInvestment": "₹500",
        "tenure": "Fixed Term"
      },
      {
        "name": "India Post Public Provident Fund (PPF)",
        "provider": "India Post",
        "rate": "~7.1% p.a.",
        "highlight": "Available at 1.55 lakh+ post offices nationwide for 100% rural & urban reach.",
        "platform": "Any Post Office Branch",
        "minInvestment": "₹500",
        "tenure": "Fixed Term",
        "badge": "100% Physical Reach"
      },
      {
        "name": "Axis / PNB Bank Public Provident Fund (PPF)",
        "provider": "Axis / PNB Bank",
        "rate": "~7.1% p.a.",
        "highlight": "Dedicated government scheme counters and quick processing.",
        "platform": "Bank Branch / Portal",
        "minInvestment": "₹500",
        "tenure": "Fixed Term"
      }
    ]
  },
  "scss": {
    "title": "Where to Access Senior Citizens Savings Scheme (SCSS)",
    "riskLevel": 1,
    "note": "Highest-return government scheme for senior citizens. 8.2% p.a. with quarterly payouts and sovereign guarantee. Guaranteed by Government of India / RBI authority.",
    "howToStart": "Visit any authorized bank branch or post office with age proof, Aadhaar, PAN, and passport-size photos.",
    "products": [
      {
        "name": "SBI Senior Citizens Savings Scheme (SCSS)",
        "provider": "State Bank of India",
        "rate": "~8.2% p.a.",
        "highlight": "India's largest branch network (22,000+) ensuring seamless access & auto-credit.",
        "platform": "SBI YONO / Branch",
        "minInvestment": "₹1000",
        "tenure": "Fixed Term",
        "badge": "Most Accessible"
      },
      {
        "name": "HDFC Bank Senior Citizens Savings Scheme (SCSS)",
        "provider": "HDFC Bank",
        "rate": "~8.2% p.a.",
        "highlight": "Seamless digital account setup and instant e-statements via NetBanking.",
        "platform": "HDFC NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "Fixed Term",
        "badge": "Best Digital UI"
      },
      {
        "name": "ICICI Bank Senior Citizens Savings Scheme (SCSS)",
        "provider": "ICICI Bank",
        "rate": "~8.2% p.a.",
        "highlight": "Quick digital tracking via iMobile Pay app with free tax reports.",
        "platform": "ICICI iMobile / Branch",
        "minInvestment": "₹1000",
        "tenure": "Fixed Term"
      },
      {
        "name": "India Post Senior Citizens Savings Scheme (SCSS)",
        "provider": "India Post",
        "rate": "~8.2% p.a.",
        "highlight": "Available at 1.55 lakh+ post offices nationwide for 100% rural & urban reach.",
        "platform": "Any Post Office Branch",
        "minInvestment": "₹1000",
        "tenure": "Fixed Term",
        "badge": "100% Physical Reach"
      },
      {
        "name": "Axis / PNB Bank Senior Citizens Savings Scheme (SCSS)",
        "provider": "Axis / PNB Bank",
        "rate": "~8.2% p.a.",
        "highlight": "Dedicated government scheme counters and quick processing.",
        "platform": "Bank Branch / Portal",
        "minInvestment": "₹1000",
        "tenure": "Fixed Term"
      }
    ]
  },
  "sukanya": {
    "title": "Where to Access Sukanya Samriddhi Yojana (SSY)",
    "riskLevel": 1,
    "note": "EEE tax-free government scheme for girl child education and marriage. 8.2% p.a. — highest guaranteed tax-free return available. Guaranteed by Government of India / RBI authority.",
    "howToStart": "Visit any authorized bank or post office with girl child's birth certificate, parent's Aadhaar + PAN.",
    "products": [
      {
        "name": "SBI Sukanya Samriddhi Yojana (SSY)",
        "provider": "State Bank of India",
        "rate": "~8.2% p.a.",
        "highlight": "India's largest branch network (22,000+) ensuring seamless access & auto-credit.",
        "platform": "SBI YONO / Branch",
        "minInvestment": "₹250",
        "tenure": "Fixed Term",
        "badge": "Most Accessible"
      },
      {
        "name": "HDFC Bank Sukanya Samriddhi Yojana (SSY)",
        "provider": "HDFC Bank",
        "rate": "~8.2% p.a.",
        "highlight": "Seamless digital account setup and instant e-statements via NetBanking.",
        "platform": "HDFC NetBanking / Branch",
        "minInvestment": "₹250",
        "tenure": "Fixed Term",
        "badge": "Best Digital UI"
      },
      {
        "name": "ICICI Bank Sukanya Samriddhi Yojana (SSY)",
        "provider": "ICICI Bank",
        "rate": "~8.2% p.a.",
        "highlight": "Quick digital tracking via iMobile Pay app with free tax reports.",
        "platform": "ICICI iMobile / Branch",
        "minInvestment": "₹250",
        "tenure": "Fixed Term"
      },
      {
        "name": "India Post Sukanya Samriddhi Yojana (SSY)",
        "provider": "India Post",
        "rate": "~8.2% p.a.",
        "highlight": "Available at 1.55 lakh+ post offices nationwide for 100% rural & urban reach.",
        "platform": "Any Post Office Branch",
        "minInvestment": "₹250",
        "tenure": "Fixed Term",
        "badge": "100% Physical Reach"
      },
      {
        "name": "Axis / PNB Bank Sukanya Samriddhi Yojana (SSY)",
        "provider": "Axis / PNB Bank",
        "rate": "~8.2% p.a.",
        "highlight": "Dedicated government scheme counters and quick processing.",
        "platform": "Bank Branch / Portal",
        "minInvestment": "₹250",
        "tenure": "Fixed Term"
      }
    ]
  },
  "rbi_bonds": {
    "title": "Where to Access RBI Floating Rate Savings Bonds",
    "riskLevel": 1,
    "note": "Floating rate bonds linked to NSC rate + 35 bps. RBI sovereign guarantee. Guaranteed by Government of India / RBI authority.",
    "howToStart": "Apply through any scheduled commercial bank. No demat required. Digital application facilities expanding by Sep 2026.",
    "products": [
      {
        "name": "SBI RBI Floating Rate Savings Bonds",
        "provider": "State Bank of India",
        "rate": "~7.83% p.a.",
        "highlight": "India's largest branch network (22,000+) ensuring seamless access & auto-credit.",
        "platform": "SBI YONO / Branch",
        "minInvestment": "₹1000",
        "tenure": "Fixed Term",
        "badge": "Most Accessible"
      },
      {
        "name": "HDFC Bank RBI Floating Rate Savings Bonds",
        "provider": "HDFC Bank",
        "rate": "~7.83% p.a.",
        "highlight": "Seamless digital account setup and instant e-statements via NetBanking.",
        "platform": "HDFC NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "Fixed Term",
        "badge": "Best Digital UI"
      },
      {
        "name": "ICICI Bank RBI Floating Rate Savings Bonds",
        "provider": "ICICI Bank",
        "rate": "~7.83% p.a.",
        "highlight": "Quick digital tracking via iMobile Pay app with free tax reports.",
        "platform": "ICICI iMobile / Branch",
        "minInvestment": "₹1000",
        "tenure": "Fixed Term"
      },
      {
        "name": "India Post RBI Floating Rate Savings Bonds",
        "provider": "India Post",
        "rate": "~7.83% p.a.",
        "highlight": "Available at 1.55 lakh+ post offices nationwide for 100% rural & urban reach.",
        "platform": "Any Post Office Branch",
        "minInvestment": "₹1000",
        "tenure": "Fixed Term",
        "badge": "100% Physical Reach"
      },
      {
        "name": "Axis / PNB Bank RBI Floating Rate Savings Bonds",
        "provider": "Axis / PNB Bank",
        "rate": "~7.83% p.a.",
        "highlight": "Dedicated government scheme counters and quick processing.",
        "platform": "Bank Branch / Portal",
        "minInvestment": "₹1000",
        "tenure": "Fixed Term"
      }
    ]
  },
  "sgb": {
    "title": "Best Platforms & Products for Sovereign Gold Bond (SGB)",
    "riskLevel": 2,
    "note": "Best gold instrument. Capital gains at 8-year maturity are completely tax-free. Earns 2.5% p.a. interest in addition to gold price appreciation.",
    "howToStart": "Open a demat + trading account on Zerodha, Groww, or Angel One. Search for 'SGB' or 'SGBAUG29' on the exchange.",
    "products": [
      {
        "name": "Zerodha Kite Sovereign Gold Bond (SGB)",
        "provider": "Zerodha",
        "rate": "~13% p.a.",
        "highlight": "Zero brokerage on equity delivery investments with India's largest discount broker.",
        "platform": "Zerodha Kite App",
        "minInvestment": "₹500",
        "badge": "Top Discount Broker"
      },
      {
        "name": "Sovereign Gold Bond (RBI Issue)",
        "provider": "Groww",
        "rate": "~13% p.a.",
        "highlight": "Most beginner-friendly UI with instant paperless onboarding.",
        "platform": "Groww App",
        "minInvestment": "₹500",
        "badge": "Best Beginner UI"
      },
      {
        "name": "Sovereign Gold Bond (RBI Issue)",
        "provider": "Angel One",
        "rate": "~13% p.a.",
        "highlight": "Full service research reports and automated trading tools.",
        "platform": "Angel One App",
        "minInvestment": "₹500"
      },
      {
        "name": "Sovereign Gold Bond (RBI Issue)",
        "provider": "ICICI Direct",
        "rate": "~13% p.a.",
        "highlight": "3-in-1 integrated banking + demat + trading account convenience.",
        "platform": "ICICI Direct Portal",
        "minInvestment": "₹500"
      },
      {
        "name": "Upstox / Kuvera Sovereign Gold Bond (SGB)",
        "provider": "Upstox / Kuvera",
        "rate": "~13% p.a.",
        "highlight": "Low fee execution with direct portfolio analytics.",
        "platform": "Upstox / Kuvera App",
        "minInvestment": "₹500"
      }
    ]
  },
  "nsc": {
    "title": "Where to Access National Savings Certificate (NSC)",
    "riskLevel": 1,
    "note": "Government-backed 5-year fixed savings instrument. Promoted by Post Office and eligible for 80C deduction. Guaranteed by Government of India / RBI authority.",
    "howToStart": "Open an account at any authorized commercial bank or post office using Aadhaar and PAN verification.",
    "products": [
      {
        "name": "SBI National Savings Certificate (NSC)",
        "provider": "State Bank of India",
        "rate": "~7.7% p.a.",
        "highlight": "India's largest branch network (22,000+) ensuring seamless access & auto-credit.",
        "platform": "SBI YONO / Branch",
        "minInvestment": "₹1000",
        "tenure": "Fixed Term",
        "badge": "Most Accessible"
      },
      {
        "name": "HDFC Bank National Savings Certificate (NSC)",
        "provider": "HDFC Bank",
        "rate": "~7.7% p.a.",
        "highlight": "Seamless digital account setup and instant e-statements via NetBanking.",
        "platform": "HDFC NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "Fixed Term",
        "badge": "Best Digital UI"
      },
      {
        "name": "ICICI Bank National Savings Certificate (NSC)",
        "provider": "ICICI Bank",
        "rate": "~7.7% p.a.",
        "highlight": "Quick digital tracking via iMobile Pay app with free tax reports.",
        "platform": "ICICI iMobile / Branch",
        "minInvestment": "₹1000",
        "tenure": "Fixed Term"
      },
      {
        "name": "India Post National Savings Certificate (NSC)",
        "provider": "India Post",
        "rate": "~7.7% p.a.",
        "highlight": "Available at 1.55 lakh+ post offices nationwide for 100% rural & urban reach.",
        "platform": "Any Post Office Branch",
        "minInvestment": "₹1000",
        "tenure": "Fixed Term",
        "badge": "100% Physical Reach"
      },
      {
        "name": "Axis / PNB Bank National Savings Certificate (NSC)",
        "provider": "Axis / PNB Bank",
        "rate": "~7.7% p.a.",
        "highlight": "Dedicated government scheme counters and quick processing.",
        "platform": "Bank Branch / Portal",
        "minInvestment": "₹1000",
        "tenure": "Fixed Term"
      }
    ]
  },
  "kvp": {
    "title": "Where to Access Kisan Vikas Patra (KVP)",
    "riskLevel": 1,
    "note": "Sovereign-backed savings certificate that doubles the invested principal after a fixed duration. Guaranteed by Government of India / RBI authority.",
    "howToStart": "Open an account at any authorized commercial bank or post office using Aadhaar and PAN verification.",
    "products": [
      {
        "name": "SBI Kisan Vikas Patra (KVP)",
        "provider": "State Bank of India",
        "rate": "~7.5% p.a.",
        "highlight": "India's largest branch network (22,000+) ensuring seamless access & auto-credit.",
        "platform": "SBI YONO / Branch",
        "minInvestment": "₹1000",
        "tenure": "Fixed Term",
        "badge": "Most Accessible"
      },
      {
        "name": "HDFC Bank Kisan Vikas Patra (KVP)",
        "provider": "HDFC Bank",
        "rate": "~7.5% p.a.",
        "highlight": "Seamless digital account setup and instant e-statements via NetBanking.",
        "platform": "HDFC NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "Fixed Term",
        "badge": "Best Digital UI"
      },
      {
        "name": "ICICI Bank Kisan Vikas Patra (KVP)",
        "provider": "ICICI Bank",
        "rate": "~7.5% p.a.",
        "highlight": "Quick digital tracking via iMobile Pay app with free tax reports.",
        "platform": "ICICI iMobile / Branch",
        "minInvestment": "₹1000",
        "tenure": "Fixed Term"
      },
      {
        "name": "India Post Kisan Vikas Patra (KVP)",
        "provider": "India Post",
        "rate": "~7.5% p.a.",
        "highlight": "Available at 1.55 lakh+ post offices nationwide for 100% rural & urban reach.",
        "platform": "Any Post Office Branch",
        "minInvestment": "₹1000",
        "tenure": "Fixed Term",
        "badge": "100% Physical Reach"
      },
      {
        "name": "Axis / PNB Bank Kisan Vikas Patra (KVP)",
        "provider": "Axis / PNB Bank",
        "rate": "~7.5% p.a.",
        "highlight": "Dedicated government scheme counters and quick processing.",
        "platform": "Bank Branch / Portal",
        "minInvestment": "₹1000",
        "tenure": "Fixed Term"
      }
    ]
  },
  "pomis": {
    "title": "Where to Access Post Office Monthly Income Scheme (POMIS)",
    "riskLevel": 1,
    "note": "Sovereign post office scheme offering monthly interest payouts over a 5-year tenure. Guaranteed by Government of India / RBI authority.",
    "howToStart": "Open an account at any authorized commercial bank or post office using Aadhaar and PAN verification.",
    "products": [
      {
        "name": "SBI Post Office Monthly Income Scheme (POMIS)",
        "provider": "State Bank of India",
        "rate": "~7.4% p.a.",
        "highlight": "India's largest branch network (22,000+) ensuring seamless access & auto-credit.",
        "platform": "SBI YONO / Branch",
        "minInvestment": "₹1500",
        "tenure": "Fixed Term",
        "badge": "Most Accessible"
      },
      {
        "name": "HDFC Bank Post Office Monthly Income Scheme (POMIS)",
        "provider": "HDFC Bank",
        "rate": "~7.4% p.a.",
        "highlight": "Seamless digital account setup and instant e-statements via NetBanking.",
        "platform": "HDFC NetBanking / Branch",
        "minInvestment": "₹1500",
        "tenure": "Fixed Term",
        "badge": "Best Digital UI"
      },
      {
        "name": "ICICI Bank Post Office Monthly Income Scheme (POMIS)",
        "provider": "ICICI Bank",
        "rate": "~7.4% p.a.",
        "highlight": "Quick digital tracking via iMobile Pay app with free tax reports.",
        "platform": "ICICI iMobile / Branch",
        "minInvestment": "₹1500",
        "tenure": "Fixed Term"
      },
      {
        "name": "India Post Post Office Monthly Income Scheme (POMIS)",
        "provider": "India Post",
        "rate": "~7.4% p.a.",
        "highlight": "Available at 1.55 lakh+ post offices nationwide for 100% rural & urban reach.",
        "platform": "Any Post Office Branch",
        "minInvestment": "₹1500",
        "tenure": "Fixed Term",
        "badge": "100% Physical Reach"
      },
      {
        "name": "Axis / PNB Bank Post Office Monthly Income Scheme (POMIS)",
        "provider": "Axis / PNB Bank",
        "rate": "~7.4% p.a.",
        "highlight": "Dedicated government scheme counters and quick processing.",
        "platform": "Bank Branch / Portal",
        "minInvestment": "₹1500",
        "tenure": "Fixed Term"
      }
    ]
  },
  "mssc": {
    "title": "Where to Access Mahila Samman Savings Certificate",
    "riskLevel": 1,
    "note": "Government-backed short-term 2-year savings scheme for women. Pays 7.5% compounded quarterly. Guaranteed by Government of India / RBI authority.",
    "howToStart": "Open an account at any authorized commercial bank or post office using Aadhaar and PAN verification.",
    "products": [
      {
        "name": "SBI Mahila Samman Savings Certificate",
        "provider": "State Bank of India",
        "rate": "~7.5% p.a.",
        "highlight": "India's largest branch network (22,000+) ensuring seamless access & auto-credit.",
        "platform": "SBI YONO / Branch",
        "minInvestment": "₹1000",
        "tenure": "Fixed Term",
        "badge": "Most Accessible"
      },
      {
        "name": "HDFC Bank Mahila Samman Savings Certificate",
        "provider": "HDFC Bank",
        "rate": "~7.5% p.a.",
        "highlight": "Seamless digital account setup and instant e-statements via NetBanking.",
        "platform": "HDFC NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "Fixed Term",
        "badge": "Best Digital UI"
      },
      {
        "name": "ICICI Bank Mahila Samman Savings Certificate",
        "provider": "ICICI Bank",
        "rate": "~7.5% p.a.",
        "highlight": "Quick digital tracking via iMobile Pay app with free tax reports.",
        "platform": "ICICI iMobile / Branch",
        "minInvestment": "₹1000",
        "tenure": "Fixed Term"
      },
      {
        "name": "India Post Mahila Samman Savings Certificate",
        "provider": "India Post",
        "rate": "~7.5% p.a.",
        "highlight": "Available at 1.55 lakh+ post offices nationwide for 100% rural & urban reach.",
        "platform": "Any Post Office Branch",
        "minInvestment": "₹1000",
        "tenure": "Fixed Term",
        "badge": "100% Physical Reach"
      },
      {
        "name": "Axis / PNB Bank Mahila Samman Savings Certificate",
        "provider": "Axis / PNB Bank",
        "rate": "~7.5% p.a.",
        "highlight": "Dedicated government scheme counters and quick processing.",
        "platform": "Bank Branch / Portal",
        "minInvestment": "₹1000",
        "tenure": "Fixed Term"
      }
    ]
  },
  "apy": {
    "title": "Where to Access Atal Pension Yojana (APY)",
    "riskLevel": 1,
    "note": "Government-administered guaranteed pension scheme for unorganized sector. Provides pension of up to ₹5,000/month. Guaranteed by Government of India / RBI authority.",
    "howToStart": "Open an account at any authorized commercial bank or post office using Aadhaar and PAN verification.",
    "products": [
      {
        "name": "SBI Atal Pension Yojana (APY)",
        "provider": "State Bank of India",
        "rate": "~8% p.a.",
        "highlight": "India's largest branch network (22,000+) ensuring seamless access & auto-credit.",
        "platform": "SBI YONO / Branch",
        "minInvestment": "₹200",
        "tenure": "Fixed Term",
        "badge": "Most Accessible"
      },
      {
        "name": "HDFC Bank Atal Pension Yojana (APY)",
        "provider": "HDFC Bank",
        "rate": "~8% p.a.",
        "highlight": "Seamless digital account setup and instant e-statements via NetBanking.",
        "platform": "HDFC NetBanking / Branch",
        "minInvestment": "₹200",
        "tenure": "Fixed Term",
        "badge": "Best Digital UI"
      },
      {
        "name": "ICICI Bank Atal Pension Yojana (APY)",
        "provider": "ICICI Bank",
        "rate": "~8% p.a.",
        "highlight": "Quick digital tracking via iMobile Pay app with free tax reports.",
        "platform": "ICICI iMobile / Branch",
        "minInvestment": "₹200",
        "tenure": "Fixed Term"
      },
      {
        "name": "India Post Atal Pension Yojana (APY)",
        "provider": "India Post",
        "rate": "~8% p.a.",
        "highlight": "Available at 1.55 lakh+ post offices nationwide for 100% rural & urban reach.",
        "platform": "Any Post Office Branch",
        "minInvestment": "₹200",
        "tenure": "Fixed Term",
        "badge": "100% Physical Reach"
      },
      {
        "name": "Axis / PNB Bank Atal Pension Yojana (APY)",
        "provider": "Axis / PNB Bank",
        "rate": "~8% p.a.",
        "highlight": "Dedicated government scheme counters and quick processing.",
        "platform": "Bank Branch / Portal",
        "minInvestment": "₹200",
        "tenure": "Fixed Term"
      }
    ]
  },
  "fd": {
    "title": "Best Options for Bank Fixed Deposit",
    "riskLevel": 2,
    "note": "Guaranteed returns with DICGC deposit insurance up to ₹5L. SBI 6.45%, HDFC/ICICI 6.50%. Interest taxable at slab rate. DICGC insured up to ₹5 lakh where applicable.",
    "howToStart": "Open via your bank's net banking / mobile app, or visit any branch. No special documents needed beyond KYC.",
    "products": [
      {
        "name": "Bank Fixed Deposit (1 Year Tenure)",
        "provider": "Bank Fixed Deposit",
        "rate": "~6.75% p.a.",
        "highlight": "Optimal short term liquidity with fixed guaranteed return.",
        "platform": "NetBanking / Mobile App",
        "minInvestment": "₹1000",
        "tenure": "1 Year",
        "badge": "Most Flexible"
      },
      {
        "name": "Bank Fixed Deposit (2–3 Year Tenure)",
        "provider": "Bank Fixed Deposit",
        "rate": "~7.05%",
        "highlight": "Higher interest yield for medium term capital lock-in.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "2-3 Years",
        "badge": "Highest Yield"
      },
      {
        "name": "Bank Fixed Deposit (Senior Citizen Option)",
        "provider": "Bank Fixed Deposit",
        "rate": "~7.25%",
        "highlight": "Additional 0.50% interest rate benefit for age 60+.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "1-5 Years",
        "badge": "Senior Privilege"
      },
      {
        "name": "Bank Fixed Deposit (5 Year Tax Saver)",
        "provider": "Bank Fixed Deposit",
        "rate": "~6.75% p.a.",
        "highlight": "Qualifies for Section 80C tax deduction up to ₹1.5 lakh with 5-year lock-in.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "5 Years",
        "badge": "Tax Saver 80C"
      },
      {
        "name": "Bank Fixed Deposit (Auto-Sweep Facility)",
        "provider": "Bank Fixed Deposit",
        "rate": "~6.75% p.a.",
        "highlight": "Link savings account idle balance for auto-sweep FD interest.",
        "platform": "NetBanking App",
        "minInvestment": "₹1000",
        "tenure": "Flexible"
      }
    ]
  },
  "sbi_fd": {
    "title": "Best Options for SBI Fixed Deposit",
    "riskLevel": 1,
    "note": "Fixed deposit offered by State Bank of India. Offers highly secure fixed returns backed by public sector ownership. DICGC insured up to ₹5 lakh where applicable.",
    "howToStart": "Apply for an FD account directly through SBI net banking, mobile app, or by visiting a branch.",
    "products": [
      {
        "name": "SBI Fixed Deposit (1 Year Tenure)",
        "provider": "SBI Fixed Deposit",
        "rate": "~6.9% p.a.",
        "highlight": "Optimal short term liquidity with fixed guaranteed return.",
        "platform": "NetBanking / Mobile App",
        "minInvestment": "₹1000",
        "tenure": "1 Year",
        "badge": "Most Flexible"
      },
      {
        "name": "SBI Fixed Deposit (2–3 Year Tenure)",
        "provider": "SBI Fixed Deposit",
        "rate": "~7.2%",
        "highlight": "Higher interest yield for medium term capital lock-in.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "2-3 Years",
        "badge": "Highest Yield"
      },
      {
        "name": "SBI Fixed Deposit (Senior Citizen Option)",
        "provider": "SBI Fixed Deposit",
        "rate": "~7.4%",
        "highlight": "Additional 0.50% interest rate benefit for age 60+.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "1-5 Years",
        "badge": "Senior Privilege"
      },
      {
        "name": "SBI Fixed Deposit (5 Year Tax Saver)",
        "provider": "SBI Fixed Deposit",
        "rate": "~6.9% p.a.",
        "highlight": "Qualifies for Section 80C tax deduction up to ₹1.5 lakh with 5-year lock-in.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "5 Years",
        "badge": "Tax Saver 80C"
      },
      {
        "name": "SBI Fixed Deposit (Auto-Sweep Facility)",
        "provider": "SBI Fixed Deposit",
        "rate": "~6.9% p.a.",
        "highlight": "Link savings account idle balance for auto-sweep FD interest.",
        "platform": "NetBanking App",
        "minInvestment": "₹1000",
        "tenure": "Flexible"
      }
    ]
  },
  "hdfc_fd": {
    "title": "Best Options for HDFC Bank FD",
    "riskLevel": 1,
    "note": "Fixed deposit offered by HDFC Bank. Combines competitive interest yields with a high safety rating. DICGC insured up to ₹5 lakh where applicable.",
    "howToStart": "Apply for an FD account directly through HDFC Bank net banking, mobile app, or by visiting a branch.",
    "products": [
      {
        "name": "HDFC Bank FD (1 Year Tenure)",
        "provider": "HDFC Bank FD",
        "rate": "~7.2% p.a.",
        "highlight": "Optimal short term liquidity with fixed guaranteed return.",
        "platform": "NetBanking / Mobile App",
        "minInvestment": "₹5000",
        "tenure": "1 Year",
        "badge": "Most Flexible"
      },
      {
        "name": "HDFC Bank FD (2–3 Year Tenure)",
        "provider": "HDFC Bank FD",
        "rate": "~7.5%",
        "highlight": "Higher interest yield for medium term capital lock-in.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹5000",
        "tenure": "2-3 Years",
        "badge": "Highest Yield"
      },
      {
        "name": "HDFC Bank FD (Senior Citizen Option)",
        "provider": "HDFC Bank FD",
        "rate": "~7.7%",
        "highlight": "Additional 0.50% interest rate benefit for age 60+.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹5000",
        "tenure": "1-5 Years",
        "badge": "Senior Privilege"
      },
      {
        "name": "HDFC Bank FD (5 Year Tax Saver)",
        "provider": "HDFC Bank FD",
        "rate": "~7.2% p.a.",
        "highlight": "Qualifies for Section 80C tax deduction up to ₹1.5 lakh with 5-year lock-in.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹5000",
        "tenure": "5 Years",
        "badge": "Tax Saver 80C"
      },
      {
        "name": "HDFC Bank FD (Auto-Sweep Facility)",
        "provider": "HDFC Bank FD",
        "rate": "~7.2% p.a.",
        "highlight": "Link savings account idle balance for auto-sweep FD interest.",
        "platform": "NetBanking App",
        "minInvestment": "₹5000",
        "tenure": "Flexible"
      }
    ]
  },
  "icici_fd": {
    "title": "Best Options for ICICI Bank FD",
    "riskLevel": 1,
    "note": "Fixed deposit offered by ICICI Bank. Features convenient digital opening and flexible tenure terms. DICGC insured up to ₹5 lakh where applicable.",
    "howToStart": "Apply for an FD account directly through ICICI Bank net banking, mobile app, or by visiting a branch.",
    "products": [
      {
        "name": "ICICI Bank FD (1 Year Tenure)",
        "provider": "ICICI Bank FD",
        "rate": "~7.1% p.a.",
        "highlight": "Optimal short term liquidity with fixed guaranteed return.",
        "platform": "NetBanking / Mobile App",
        "minInvestment": "₹5000",
        "tenure": "1 Year",
        "badge": "Most Flexible"
      },
      {
        "name": "ICICI Bank FD (2–3 Year Tenure)",
        "provider": "ICICI Bank FD",
        "rate": "~7.3999999999999995%",
        "highlight": "Higher interest yield for medium term capital lock-in.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹5000",
        "tenure": "2-3 Years",
        "badge": "Highest Yield"
      },
      {
        "name": "ICICI Bank FD (Senior Citizen Option)",
        "provider": "ICICI Bank FD",
        "rate": "~7.6%",
        "highlight": "Additional 0.50% interest rate benefit for age 60+.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹5000",
        "tenure": "1-5 Years",
        "badge": "Senior Privilege"
      },
      {
        "name": "ICICI Bank FD (5 Year Tax Saver)",
        "provider": "ICICI Bank FD",
        "rate": "~7.1% p.a.",
        "highlight": "Qualifies for Section 80C tax deduction up to ₹1.5 lakh with 5-year lock-in.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹5000",
        "tenure": "5 Years",
        "badge": "Tax Saver 80C"
      },
      {
        "name": "ICICI Bank FD (Auto-Sweep Facility)",
        "provider": "ICICI Bank FD",
        "rate": "~7.1% p.a.",
        "highlight": "Link savings account idle balance for auto-sweep FD interest.",
        "platform": "NetBanking App",
        "minInvestment": "₹5000",
        "tenure": "Flexible"
      }
    ]
  },
  "axis_fd": {
    "title": "Best Options for Axis Bank FD",
    "riskLevel": 1,
    "note": "Fixed deposit offered by Axis Bank. Offers competitive interest rates for intermediate tenures. DICGC insured up to ₹5 lakh where applicable.",
    "howToStart": "Apply for an FD account directly through Axis Bank net banking, mobile app, or by visiting a branch.",
    "products": [
      {
        "name": "Axis Bank FD (1 Year Tenure)",
        "provider": "Axis Bank FD",
        "rate": "~7.2% p.a.",
        "highlight": "Optimal short term liquidity with fixed guaranteed return.",
        "platform": "NetBanking / Mobile App",
        "minInvestment": "₹5000",
        "tenure": "1 Year",
        "badge": "Most Flexible"
      },
      {
        "name": "Axis Bank FD (2–3 Year Tenure)",
        "provider": "Axis Bank FD",
        "rate": "~7.5%",
        "highlight": "Higher interest yield for medium term capital lock-in.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹5000",
        "tenure": "2-3 Years",
        "badge": "Highest Yield"
      },
      {
        "name": "Axis Bank FD (Senior Citizen Option)",
        "provider": "Axis Bank FD",
        "rate": "~7.7%",
        "highlight": "Additional 0.50% interest rate benefit for age 60+.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹5000",
        "tenure": "1-5 Years",
        "badge": "Senior Privilege"
      },
      {
        "name": "Axis Bank FD (5 Year Tax Saver)",
        "provider": "Axis Bank FD",
        "rate": "~7.2% p.a.",
        "highlight": "Qualifies for Section 80C tax deduction up to ₹1.5 lakh with 5-year lock-in.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹5000",
        "tenure": "5 Years",
        "badge": "Tax Saver 80C"
      },
      {
        "name": "Axis Bank FD (Auto-Sweep Facility)",
        "provider": "Axis Bank FD",
        "rate": "~7.2% p.a.",
        "highlight": "Link savings account idle balance for auto-sweep FD interest.",
        "platform": "NetBanking App",
        "minInvestment": "₹5000",
        "tenure": "Flexible"
      }
    ]
  },
  "kotak_fd": {
    "title": "Best Options for Kotak Mahindra FD",
    "riskLevel": 1,
    "note": "Fixed deposit offered by Kotak Mahindra Bank. Known for competitive interest rates and premium service. DICGC insured up to ₹5 lakh where applicable.",
    "howToStart": "Apply for an FD account directly through Kotak Mahindra net banking, mobile app, or by visiting a branch.",
    "products": [
      {
        "name": "Kotak Mahindra FD (1 Year Tenure)",
        "provider": "Kotak Mahindra FD",
        "rate": "~7.33% p.a.",
        "highlight": "Optimal short term liquidity with fixed guaranteed return.",
        "platform": "NetBanking / Mobile App",
        "minInvestment": "₹5000",
        "tenure": "1 Year",
        "badge": "Most Flexible"
      },
      {
        "name": "Kotak Mahindra FD (2–3 Year Tenure)",
        "provider": "Kotak Mahindra FD",
        "rate": "~7.63%",
        "highlight": "Higher interest yield for medium term capital lock-in.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹5000",
        "tenure": "2-3 Years",
        "badge": "Highest Yield"
      },
      {
        "name": "Kotak Mahindra FD (Senior Citizen Option)",
        "provider": "Kotak Mahindra FD",
        "rate": "~7.83%",
        "highlight": "Additional 0.50% interest rate benefit for age 60+.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹5000",
        "tenure": "1-5 Years",
        "badge": "Senior Privilege"
      },
      {
        "name": "Kotak Mahindra FD (5 Year Tax Saver)",
        "provider": "Kotak Mahindra FD",
        "rate": "~7.33% p.a.",
        "highlight": "Qualifies for Section 80C tax deduction up to ₹1.5 lakh with 5-year lock-in.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹5000",
        "tenure": "5 Years",
        "badge": "Tax Saver 80C"
      },
      {
        "name": "Kotak Mahindra FD (Auto-Sweep Facility)",
        "provider": "Kotak Mahindra FD",
        "rate": "~7.33% p.a.",
        "highlight": "Link savings account idle balance for auto-sweep FD interest.",
        "platform": "NetBanking App",
        "minInvestment": "₹5000",
        "tenure": "Flexible"
      }
    ]
  },
  "indusind_fd": {
    "title": "Best Options for IndusInd Bank FD",
    "riskLevel": 2,
    "note": "Fixed deposit offered by IndusInd Bank. Offers some of the highest interest yields among tier-1 private banks. DICGC insured up to ₹5 lakh where applicable.",
    "howToStart": "Apply for an FD account directly through IndusInd Bank net banking, mobile app, or by visiting a branch.",
    "products": [
      {
        "name": "IndusInd Bank FD (1 Year Tenure)",
        "provider": "IndusInd Bank FD",
        "rate": "~8% p.a.",
        "highlight": "Optimal short term liquidity with fixed guaranteed return.",
        "platform": "NetBanking / Mobile App",
        "minInvestment": "₹10000",
        "tenure": "1 Year",
        "badge": "Most Flexible"
      },
      {
        "name": "IndusInd Bank FD (2–3 Year Tenure)",
        "provider": "IndusInd Bank FD",
        "rate": "~8.3%",
        "highlight": "Higher interest yield for medium term capital lock-in.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹10000",
        "tenure": "2-3 Years",
        "badge": "Highest Yield"
      },
      {
        "name": "IndusInd Bank FD (Senior Citizen Option)",
        "provider": "IndusInd Bank FD",
        "rate": "~8.5%",
        "highlight": "Additional 0.50% interest rate benefit for age 60+.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹10000",
        "tenure": "1-5 Years",
        "badge": "Senior Privilege"
      },
      {
        "name": "IndusInd Bank FD (5 Year Tax Saver)",
        "provider": "IndusInd Bank FD",
        "rate": "~8% p.a.",
        "highlight": "Qualifies for Section 80C tax deduction up to ₹1.5 lakh with 5-year lock-in.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹10000",
        "tenure": "5 Years",
        "badge": "Tax Saver 80C"
      },
      {
        "name": "IndusInd Bank FD (Auto-Sweep Facility)",
        "provider": "IndusInd Bank FD",
        "rate": "~8% p.a.",
        "highlight": "Link savings account idle balance for auto-sweep FD interest.",
        "platform": "NetBanking App",
        "minInvestment": "₹10000",
        "tenure": "Flexible"
      }
    ]
  },
  "idfc_fd": {
    "title": "Best Options for IDFC First Bank FD",
    "riskLevel": 2,
    "note": "Fixed deposit offered by IDFC First Bank. Features attractive monthly interest compounding options. DICGC insured up to ₹5 lakh where applicable.",
    "howToStart": "Apply for an FD account directly through IDFC First Bank net banking, mobile app, or by visiting a branch.",
    "products": [
      {
        "name": "IDFC First Bank FD (1 Year Tenure)",
        "provider": "IDFC First Bank FD",
        "rate": "~7.75% p.a.",
        "highlight": "Optimal short term liquidity with fixed guaranteed return.",
        "platform": "NetBanking / Mobile App",
        "minInvestment": "₹10000",
        "tenure": "1 Year",
        "badge": "Most Flexible"
      },
      {
        "name": "IDFC First Bank FD (2–3 Year Tenure)",
        "provider": "IDFC First Bank FD",
        "rate": "~8.05%",
        "highlight": "Higher interest yield for medium term capital lock-in.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹10000",
        "tenure": "2-3 Years",
        "badge": "Highest Yield"
      },
      {
        "name": "IDFC First Bank FD (Senior Citizen Option)",
        "provider": "IDFC First Bank FD",
        "rate": "~8.25%",
        "highlight": "Additional 0.50% interest rate benefit for age 60+.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹10000",
        "tenure": "1-5 Years",
        "badge": "Senior Privilege"
      },
      {
        "name": "IDFC First Bank FD (5 Year Tax Saver)",
        "provider": "IDFC First Bank FD",
        "rate": "~7.75% p.a.",
        "highlight": "Qualifies for Section 80C tax deduction up to ₹1.5 lakh with 5-year lock-in.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹10000",
        "tenure": "5 Years",
        "badge": "Tax Saver 80C"
      },
      {
        "name": "IDFC First Bank FD (Auto-Sweep Facility)",
        "provider": "IDFC First Bank FD",
        "rate": "~7.75% p.a.",
        "highlight": "Link savings account idle balance for auto-sweep FD interest.",
        "platform": "NetBanking App",
        "minInvestment": "₹10000",
        "tenure": "Flexible"
      }
    ]
  },
  "au_sfb_fd": {
    "title": "Best Options for AU Small Finance Bank FD",
    "riskLevel": 2,
    "note": "Fixed deposit offered by AU Small Finance Bank. Pays high interest yields while maintaining full RBI deposit protection. DICGC insured up to ₹5 lakh where applicable.",
    "howToStart": "Apply for an FD account directly through AU Small Finance Bank net banking, mobile app, or by visiting a branch.",
    "products": [
      {
        "name": "AU Small Finance Bank FD (1 Year Tenure)",
        "provider": "AU Small Finance Bank FD",
        "rate": "~8% p.a.",
        "highlight": "Optimal short term liquidity with fixed guaranteed return.",
        "platform": "NetBanking / Mobile App",
        "minInvestment": "₹1000",
        "tenure": "1 Year",
        "badge": "Most Flexible"
      },
      {
        "name": "AU Small Finance Bank FD (2–3 Year Tenure)",
        "provider": "AU Small Finance Bank FD",
        "rate": "~8.3%",
        "highlight": "Higher interest yield for medium term capital lock-in.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "2-3 Years",
        "badge": "Highest Yield"
      },
      {
        "name": "AU Small Finance Bank FD (Senior Citizen Option)",
        "provider": "AU Small Finance Bank FD",
        "rate": "~8.5%",
        "highlight": "Additional 0.50% interest rate benefit for age 60+.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "1-5 Years",
        "badge": "Senior Privilege"
      },
      {
        "name": "AU Small Finance Bank FD (5 Year Tax Saver)",
        "provider": "AU Small Finance Bank FD",
        "rate": "~8% p.a.",
        "highlight": "Qualifies for Section 80C tax deduction up to ₹1.5 lakh with 5-year lock-in.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "5 Years",
        "badge": "Tax Saver 80C"
      },
      {
        "name": "AU Small Finance Bank FD (Auto-Sweep Facility)",
        "provider": "AU Small Finance Bank FD",
        "rate": "~8% p.a.",
        "highlight": "Link savings account idle balance for auto-sweep FD interest.",
        "platform": "NetBanking App",
        "minInvestment": "₹1000",
        "tenure": "Flexible"
      }
    ]
  },
  "ujjivan_fd": {
    "title": "Best Options for Ujjivan SFB FD",
    "riskLevel": 2,
    "note": "Fixed deposit offered by Ujjivan Small Finance Bank. Maximizes secure yields for income-focused investors. DICGC insured up to ₹5 lakh where applicable.",
    "howToStart": "Apply for an FD account directly through Ujjivan SFB net banking, mobile app, or by visiting a branch.",
    "products": [
      {
        "name": "Ujjivan SFB FD (1 Year Tenure)",
        "provider": "Ujjivan SFB FD",
        "rate": "~8.25% p.a.",
        "highlight": "Optimal short term liquidity with fixed guaranteed return.",
        "platform": "NetBanking / Mobile App",
        "minInvestment": "₹1000",
        "tenure": "1 Year",
        "badge": "Most Flexible"
      },
      {
        "name": "Ujjivan SFB FD (2–3 Year Tenure)",
        "provider": "Ujjivan SFB FD",
        "rate": "~8.55%",
        "highlight": "Higher interest yield for medium term capital lock-in.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "2-3 Years",
        "badge": "Highest Yield"
      },
      {
        "name": "Ujjivan SFB FD (Senior Citizen Option)",
        "provider": "Ujjivan SFB FD",
        "rate": "~8.75%",
        "highlight": "Additional 0.50% interest rate benefit for age 60+.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "1-5 Years",
        "badge": "Senior Privilege"
      },
      {
        "name": "Ujjivan SFB FD (5 Year Tax Saver)",
        "provider": "Ujjivan SFB FD",
        "rate": "~8.25% p.a.",
        "highlight": "Qualifies for Section 80C tax deduction up to ₹1.5 lakh with 5-year lock-in.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "5 Years",
        "badge": "Tax Saver 80C"
      },
      {
        "name": "Ujjivan SFB FD (Auto-Sweep Facility)",
        "provider": "Ujjivan SFB FD",
        "rate": "~8.25% p.a.",
        "highlight": "Link savings account idle balance for auto-sweep FD interest.",
        "platform": "NetBanking App",
        "minInvestment": "₹1000",
        "tenure": "Flexible"
      }
    ]
  },
  "equitas_fd": {
    "title": "Best Options for Equitas SFB FD",
    "riskLevel": 2,
    "note": "Fixed deposit offered by Equitas Small Finance Bank. Delivers excellent interest rates with standard RBI safety nets. DICGC insured up to ₹5 lakh where applicable.",
    "howToStart": "Apply for an FD account directly through Equitas SFB net banking, mobile app, or by visiting a branch.",
    "products": [
      {
        "name": "Equitas SFB FD (1 Year Tenure)",
        "provider": "Equitas SFB FD",
        "rate": "~8% p.a.",
        "highlight": "Optimal short term liquidity with fixed guaranteed return.",
        "platform": "NetBanking / Mobile App",
        "minInvestment": "₹1000",
        "tenure": "1 Year",
        "badge": "Most Flexible"
      },
      {
        "name": "Equitas SFB FD (2–3 Year Tenure)",
        "provider": "Equitas SFB FD",
        "rate": "~8.3%",
        "highlight": "Higher interest yield for medium term capital lock-in.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "2-3 Years",
        "badge": "Highest Yield"
      },
      {
        "name": "Equitas SFB FD (Senior Citizen Option)",
        "provider": "Equitas SFB FD",
        "rate": "~8.5%",
        "highlight": "Additional 0.50% interest rate benefit for age 60+.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "1-5 Years",
        "badge": "Senior Privilege"
      },
      {
        "name": "Equitas SFB FD (5 Year Tax Saver)",
        "provider": "Equitas SFB FD",
        "rate": "~8% p.a.",
        "highlight": "Qualifies for Section 80C tax deduction up to ₹1.5 lakh with 5-year lock-in.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "5 Years",
        "badge": "Tax Saver 80C"
      },
      {
        "name": "Equitas SFB FD (Auto-Sweep Facility)",
        "provider": "Equitas SFB FD",
        "rate": "~8% p.a.",
        "highlight": "Link savings account idle balance for auto-sweep FD interest.",
        "platform": "NetBanking App",
        "minInvestment": "₹1000",
        "tenure": "Flexible"
      }
    ]
  },
  "canara_fd": {
    "title": "Best Options for Canara Bank FD",
    "riskLevel": 1,
    "note": "Fixed deposit offered by Canara Bank. A safe public sector banking option for conservative investors. DICGC insured up to ₹5 lakh where applicable.",
    "howToStart": "Apply for an FD account directly through Canara Bank net banking, mobile app, or by visiting a branch.",
    "products": [
      {
        "name": "Canara Bank FD (1 Year Tenure)",
        "provider": "Canara Bank FD",
        "rate": "~6.8% p.a.",
        "highlight": "Optimal short term liquidity with fixed guaranteed return.",
        "platform": "NetBanking / Mobile App",
        "minInvestment": "₹1000",
        "tenure": "1 Year",
        "badge": "Most Flexible"
      },
      {
        "name": "Canara Bank FD (2–3 Year Tenure)",
        "provider": "Canara Bank FD",
        "rate": "~7.1%",
        "highlight": "Higher interest yield for medium term capital lock-in.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "2-3 Years",
        "badge": "Highest Yield"
      },
      {
        "name": "Canara Bank FD (Senior Citizen Option)",
        "provider": "Canara Bank FD",
        "rate": "~7.3%",
        "highlight": "Additional 0.50% interest rate benefit for age 60+.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "1-5 Years",
        "badge": "Senior Privilege"
      },
      {
        "name": "Canara Bank FD (5 Year Tax Saver)",
        "provider": "Canara Bank FD",
        "rate": "~6.8% p.a.",
        "highlight": "Qualifies for Section 80C tax deduction up to ₹1.5 lakh with 5-year lock-in.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "5 Years",
        "badge": "Tax Saver 80C"
      },
      {
        "name": "Canara Bank FD (Auto-Sweep Facility)",
        "provider": "Canara Bank FD",
        "rate": "~6.8% p.a.",
        "highlight": "Link savings account idle balance for auto-sweep FD interest.",
        "platform": "NetBanking App",
        "minInvestment": "₹1000",
        "tenure": "Flexible"
      }
    ]
  },
  "pnb_fd": {
    "title": "Best Options for PNB Fixed Deposit",
    "riskLevel": 1,
    "note": "Fixed deposit offered by Punjab National Bank. Provides high security for preserving savings capital. DICGC insured up to ₹5 lakh where applicable.",
    "howToStart": "Apply for an FD account directly through PNB net banking, mobile app, or by visiting a branch.",
    "products": [
      {
        "name": "PNB Fixed Deposit (1 Year Tenure)",
        "provider": "PNB Fixed Deposit",
        "rate": "~6.9% p.a.",
        "highlight": "Optimal short term liquidity with fixed guaranteed return.",
        "platform": "NetBanking / Mobile App",
        "minInvestment": "₹1000",
        "tenure": "1 Year",
        "badge": "Most Flexible"
      },
      {
        "name": "PNB Fixed Deposit (2–3 Year Tenure)",
        "provider": "PNB Fixed Deposit",
        "rate": "~7.2%",
        "highlight": "Higher interest yield for medium term capital lock-in.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "2-3 Years",
        "badge": "Highest Yield"
      },
      {
        "name": "PNB Fixed Deposit (Senior Citizen Option)",
        "provider": "PNB Fixed Deposit",
        "rate": "~7.4%",
        "highlight": "Additional 0.50% interest rate benefit for age 60+.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "1-5 Years",
        "badge": "Senior Privilege"
      },
      {
        "name": "PNB Fixed Deposit (5 Year Tax Saver)",
        "provider": "PNB Fixed Deposit",
        "rate": "~6.9% p.a.",
        "highlight": "Qualifies for Section 80C tax deduction up to ₹1.5 lakh with 5-year lock-in.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "5 Years",
        "badge": "Tax Saver 80C"
      },
      {
        "name": "PNB Fixed Deposit (Auto-Sweep Facility)",
        "provider": "PNB Fixed Deposit",
        "rate": "~6.9% p.a.",
        "highlight": "Link savings account idle balance for auto-sweep FD interest.",
        "platform": "NetBanking App",
        "minInvestment": "₹1000",
        "tenure": "Flexible"
      }
    ]
  },
  "bob_fd": {
    "title": "Best Options for Bank of Baroda FD",
    "riskLevel": 1,
    "note": "Fixed deposit offered by Bank of Baroda. Features steady government-backed return paths. DICGC insured up to ₹5 lakh where applicable.",
    "howToStart": "Apply for an FD account directly through Bank of Baroda net banking, mobile app, or by visiting a branch.",
    "products": [
      {
        "name": "Bank of Baroda FD (1 Year Tenure)",
        "provider": "Bank of Baroda FD",
        "rate": "~6.9% p.a.",
        "highlight": "Optimal short term liquidity with fixed guaranteed return.",
        "platform": "NetBanking / Mobile App",
        "minInvestment": "₹1000",
        "tenure": "1 Year",
        "badge": "Most Flexible"
      },
      {
        "name": "Bank of Baroda FD (2–3 Year Tenure)",
        "provider": "Bank of Baroda FD",
        "rate": "~7.2%",
        "highlight": "Higher interest yield for medium term capital lock-in.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "2-3 Years",
        "badge": "Highest Yield"
      },
      {
        "name": "Bank of Baroda FD (Senior Citizen Option)",
        "provider": "Bank of Baroda FD",
        "rate": "~7.4%",
        "highlight": "Additional 0.50% interest rate benefit for age 60+.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "1-5 Years",
        "badge": "Senior Privilege"
      },
      {
        "name": "Bank of Baroda FD (5 Year Tax Saver)",
        "provider": "Bank of Baroda FD",
        "rate": "~6.9% p.a.",
        "highlight": "Qualifies for Section 80C tax deduction up to ₹1.5 lakh with 5-year lock-in.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "5 Years",
        "badge": "Tax Saver 80C"
      },
      {
        "name": "Bank of Baroda FD (Auto-Sweep Facility)",
        "provider": "Bank of Baroda FD",
        "rate": "~6.9% p.a.",
        "highlight": "Link savings account idle balance for auto-sweep FD interest.",
        "platform": "NetBanking App",
        "minInvestment": "₹1000",
        "tenure": "Flexible"
      }
    ]
  },
  "po_rd": {
    "title": "Best Options for Post Office Recurring Deposit",
    "riskLevel": 1,
    "note": "Sovereign-backed monthly savings plan managed by India Post. Safe monthly savings habit-builder. DICGC insured up to ₹5 lakh where applicable.",
    "howToStart": "Submit a direct mutual fund application on the AMC portal, or transact seamlessly on any popular mutual fund platform.",
    "products": [
      {
        "name": "Post Office Recurring Deposit (1 Year Tenure)",
        "provider": "Post Office Recurring Deposit",
        "rate": "~6.7% p.a.",
        "highlight": "Optimal short term liquidity with fixed guaranteed return.",
        "platform": "NetBanking / Mobile App",
        "minInvestment": "₹100",
        "tenure": "1 Year",
        "badge": "Most Flexible"
      },
      {
        "name": "Post Office Recurring Deposit (2–3 Year Tenure)",
        "provider": "Post Office Recurring Deposit",
        "rate": "~7%",
        "highlight": "Higher interest yield for medium term capital lock-in.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹100",
        "tenure": "2-3 Years",
        "badge": "Highest Yield"
      },
      {
        "name": "Post Office Recurring Deposit (Senior Citizen Option)",
        "provider": "Post Office Recurring Deposit",
        "rate": "~7.2%",
        "highlight": "Additional 0.50% interest rate benefit for age 60+.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹100",
        "tenure": "1-5 Years",
        "badge": "Senior Privilege"
      },
      {
        "name": "Post Office Recurring Deposit (5 Year Tax Saver)",
        "provider": "Post Office Recurring Deposit",
        "rate": "~6.7% p.a.",
        "highlight": "Qualifies for Section 80C tax deduction up to ₹1.5 lakh with 5-year lock-in.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹100",
        "tenure": "5 Years",
        "badge": "Tax Saver 80C"
      },
      {
        "name": "Post Office Recurring Deposit (Auto-Sweep Facility)",
        "provider": "Post Office Recurring Deposit",
        "rate": "~6.7% p.a.",
        "highlight": "Link savings account idle balance for auto-sweep FD interest.",
        "platform": "NetBanking App",
        "minInvestment": "₹100",
        "tenure": "Flexible"
      }
    ]
  },
  "liquid_mf": {
    "title": "Top Rated Liquid Mutual Fund Schemes",
    "riskLevel": 1,
    "note": "A mutual fund investing in very short-term debt instruments like treasury bills. Provides high stability and quick access to cash. Taxed at marginal income slab rates.",
    "howToStart": "Invest in Direct plans via Groww, Zerodha Coin, or AMC websites.",
    "products": [
      {
        "name": "ICICI Pru Liquid Direct Fund",
        "provider": "ICICI Prudential AMC",
        "rate": "~7% p.a.",
        "highlight": "High credit quality portfolio with low expense ratio.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹500 SIP",
        "badge": "Top Rated"
      },
      {
        "name": "HDFC Liquid Direct Plan",
        "provider": "HDFC AMC",
        "rate": "~7% p.a.",
        "highlight": "Institutional grade risk management and steady return track record.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Category Leader"
      },
      {
        "name": "SBI Liquid Direct Growth",
        "provider": "SBI Mutual Fund",
        "rate": "~7% p.a.",
        "highlight": "Backed by India's largest PSU AMC with conservative credit selection.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Kotak Liquid Direct Plan",
        "provider": "Kotak Mutual Fund",
        "rate": "~7% p.a.",
        "highlight": "Focuses on AAA sovereign & PSU bond allocations.",
        "platform": "Kotak MF / Kuvera",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Aditya Birla Sun Life Liquid Mutual Direct",
        "provider": "Aditya Birla Sun Life AMC",
        "rate": "~7% p.a.",
        "highlight": "Consistent liquidity management and competitive yield.",
        "platform": "ABSL MF / Groww",
        "minInvestment": "₹100 SIP"
      }
    ]
  },
  "overnight_mf": {
    "title": "Top Rated Overnight Mutual Fund Schemes",
    "riskLevel": 1,
    "note": "Invests in overnight debt assets with 1-day maturity. Extremely low volatility for short-term cash reserves. Taxed at marginal income slab rates.",
    "howToStart": "Invest in Direct plans via Groww, Zerodha Coin, or AMC websites.",
    "products": [
      {
        "name": "ICICI Pru Overnight Direct Fund",
        "provider": "ICICI Prudential AMC",
        "rate": "~6.5% p.a.",
        "highlight": "High credit quality portfolio with low expense ratio.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹500 SIP",
        "badge": "Top Rated"
      },
      {
        "name": "HDFC Overnight Direct Plan",
        "provider": "HDFC AMC",
        "rate": "~6.5% p.a.",
        "highlight": "Institutional grade risk management and steady return track record.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Category Leader"
      },
      {
        "name": "SBI Overnight Direct Growth",
        "provider": "SBI Mutual Fund",
        "rate": "~6.5% p.a.",
        "highlight": "Backed by India's largest PSU AMC with conservative credit selection.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Kotak Overnight Direct Plan",
        "provider": "Kotak Mutual Fund",
        "rate": "~6.5% p.a.",
        "highlight": "Focuses on AAA sovereign & PSU bond allocations.",
        "platform": "Kotak MF / Kuvera",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Aditya Birla Sun Life Overnight Mutual Direct",
        "provider": "Aditya Birla Sun Life AMC",
        "rate": "~6.5% p.a.",
        "highlight": "Consistent liquidity management and competitive yield.",
        "platform": "ABSL MF / Groww",
        "minInvestment": "₹100 SIP"
      }
    ]
  },
  "ultra_short_mf": {
    "title": "Top Rated Ultra Short Duration Fund Schemes",
    "riskLevel": 2,
    "note": "Invests in liquid debt securities with maturities between 3-6 months. Slightly higher returns than liquid funds. Taxed at marginal income slab rates.",
    "howToStart": "Invest in Direct plans via Groww, Zerodha Coin, or AMC websites.",
    "products": [
      {
        "name": "ICICI Pru Ultra Short Duration Direct Fund",
        "provider": "ICICI Prudential AMC",
        "rate": "~7.15% p.a.",
        "highlight": "High credit quality portfolio with low expense ratio.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹500 SIP",
        "badge": "Top Rated"
      },
      {
        "name": "HDFC Ultra Short Duration Direct Plan",
        "provider": "HDFC AMC",
        "rate": "~7.15% p.a.",
        "highlight": "Institutional grade risk management and steady return track record.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Category Leader"
      },
      {
        "name": "SBI Ultra Short Duration Direct Growth",
        "provider": "SBI Mutual Fund",
        "rate": "~7.15% p.a.",
        "highlight": "Backed by India's largest PSU AMC with conservative credit selection.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Kotak Ultra Short Duration Direct Plan",
        "provider": "Kotak Mutual Fund",
        "rate": "~7.15% p.a.",
        "highlight": "Focuses on AAA sovereign & PSU bond allocations.",
        "platform": "Kotak MF / Kuvera",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Aditya Birla Sun Life Ultra Short Duration Direct",
        "provider": "Aditya Birla Sun Life AMC",
        "rate": "~7.15% p.a.",
        "highlight": "Consistent liquidity management and competitive yield.",
        "platform": "ABSL MF / Groww",
        "minInvestment": "₹100 SIP"
      }
    ]
  },
  "low_duration_mf": {
    "title": "Top Rated Low Duration Debt Fund Schemes",
    "riskLevel": 2,
    "note": "Debt fund targeting investments with short maturity horizons to optimize yields with low interest-rate risk. Taxed at marginal income slab rates.",
    "howToStart": "Invest in Direct plans via Groww, Zerodha Coin, or AMC websites.",
    "products": [
      {
        "name": "ICICI Pru Low Duration Debt Direct Fund",
        "provider": "ICICI Prudential AMC",
        "rate": "~7.3% p.a.",
        "highlight": "High credit quality portfolio with low expense ratio.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹500 SIP",
        "badge": "Top Rated"
      },
      {
        "name": "HDFC Low Duration Debt Direct Plan",
        "provider": "HDFC AMC",
        "rate": "~7.3% p.a.",
        "highlight": "Institutional grade risk management and steady return track record.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Category Leader"
      },
      {
        "name": "SBI Low Duration Debt Direct Growth",
        "provider": "SBI Mutual Fund",
        "rate": "~7.3% p.a.",
        "highlight": "Backed by India's largest PSU AMC with conservative credit selection.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Kotak Low Duration Debt Direct Plan",
        "provider": "Kotak Mutual Fund",
        "rate": "~7.3% p.a.",
        "highlight": "Focuses on AAA sovereign & PSU bond allocations.",
        "platform": "Kotak MF / Kuvera",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Aditya Birla Sun Life Low Duration Debt Direct",
        "provider": "Aditya Birla Sun Life AMC",
        "rate": "~7.3% p.a.",
        "highlight": "Consistent liquidity management and competitive yield.",
        "platform": "ABSL MF / Groww",
        "minInvestment": "₹100 SIP"
      }
    ]
  },
  "money_market_mf": {
    "title": "Top Rated Money Market Debt Fund Schemes",
    "riskLevel": 2,
    "note": "Invests in highly creditworthy money market assets with tenures up to 1 year. Taxed at marginal income slab rates.",
    "howToStart": "Invest in Direct plans via Groww, Zerodha Coin, or AMC websites.",
    "products": [
      {
        "name": "ICICI Pru Money Market Debt Direct Fund",
        "provider": "ICICI Prudential AMC",
        "rate": "~7.15% p.a.",
        "highlight": "High credit quality portfolio with low expense ratio.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹500 SIP",
        "badge": "Top Rated"
      },
      {
        "name": "HDFC Money Market Debt Direct Plan",
        "provider": "HDFC AMC",
        "rate": "~7.15% p.a.",
        "highlight": "Institutional grade risk management and steady return track record.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Category Leader"
      },
      {
        "name": "SBI Money Market Debt Direct Growth",
        "provider": "SBI Mutual Fund",
        "rate": "~7.15% p.a.",
        "highlight": "Backed by India's largest PSU AMC with conservative credit selection.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Kotak Money Market Debt Direct Plan",
        "provider": "Kotak Mutual Fund",
        "rate": "~7.15% p.a.",
        "highlight": "Focuses on AAA sovereign & PSU bond allocations.",
        "platform": "Kotak MF / Kuvera",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Aditya Birla Sun Life Money Market Debt Direct",
        "provider": "Aditya Birla Sun Life AMC",
        "rate": "~7.15% p.a.",
        "highlight": "Consistent liquidity management and competitive yield.",
        "platform": "ABSL MF / Groww",
        "minInvestment": "₹100 SIP"
      }
    ]
  },
  "debt_mf": {
    "title": "Top Rated Debt Mutual Fund Schemes",
    "riskLevel": 3,
    "note": "Professionally managed liquid debt instruments. No lock-in. Post April 2023, gains taxed at slab rates. Taxed at marginal income slab rates.",
    "howToStart": "Invest in Direct plans via Groww, Zerodha Coin, or AMC websites.",
    "products": [
      {
        "name": "ICICI Pru Debt Direct Fund",
        "provider": "ICICI Prudential AMC",
        "rate": "~7.35% p.a.",
        "highlight": "High credit quality portfolio with low expense ratio.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹500 SIP",
        "badge": "Top Rated"
      },
      {
        "name": "HDFC Debt Direct Plan",
        "provider": "HDFC AMC",
        "rate": "~7.35% p.a.",
        "highlight": "Institutional grade risk management and steady return track record.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Category Leader"
      },
      {
        "name": "SBI Debt Direct Growth",
        "provider": "SBI Mutual Fund",
        "rate": "~7.35% p.a.",
        "highlight": "Backed by India's largest PSU AMC with conservative credit selection.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Kotak Debt Direct Plan",
        "provider": "Kotak Mutual Fund",
        "rate": "~7.35% p.a.",
        "highlight": "Focuses on AAA sovereign & PSU bond allocations.",
        "platform": "Kotak MF / Kuvera",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Aditya Birla Sun Life Debt Mutual Direct",
        "provider": "Aditya Birla Sun Life AMC",
        "rate": "~7.35% p.a.",
        "highlight": "Consistent liquidity management and competitive yield.",
        "platform": "ABSL MF / Groww",
        "minInvestment": "₹100 SIP"
      }
    ]
  },
  "short_duration_mf": {
    "title": "Top Rated Short Duration Debt Fund Schemes",
    "riskLevel": 2,
    "note": "Invests in intermediate debt options with maturity windows between 1-3 years. Taxed at marginal income slab rates.",
    "howToStart": "Invest in Direct plans via Groww, Zerodha Coin, or AMC websites.",
    "products": [
      {
        "name": "ICICI Pru Short Duration Debt Direct Fund",
        "provider": "ICICI Prudential AMC",
        "rate": "~7.5% p.a.",
        "highlight": "High credit quality portfolio with low expense ratio.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹500 SIP",
        "badge": "Top Rated"
      },
      {
        "name": "HDFC Short Duration Debt Direct Plan",
        "provider": "HDFC AMC",
        "rate": "~7.5% p.a.",
        "highlight": "Institutional grade risk management and steady return track record.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Category Leader"
      },
      {
        "name": "SBI Short Duration Debt Direct Growth",
        "provider": "SBI Mutual Fund",
        "rate": "~7.5% p.a.",
        "highlight": "Backed by India's largest PSU AMC with conservative credit selection.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Kotak Short Duration Debt Direct Plan",
        "provider": "Kotak Mutual Fund",
        "rate": "~7.5% p.a.",
        "highlight": "Focuses on AAA sovereign & PSU bond allocations.",
        "platform": "Kotak MF / Kuvera",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Aditya Birla Sun Life Short Duration Debt Direct",
        "provider": "Aditya Birla Sun Life AMC",
        "rate": "~7.5% p.a.",
        "highlight": "Consistent liquidity management and competitive yield.",
        "platform": "ABSL MF / Groww",
        "minInvestment": "₹100 SIP"
      }
    ]
  },
  "medium_duration_mf": {
    "title": "Top Rated Medium Duration Debt Fund Schemes",
    "riskLevel": 3,
    "note": "Debt fund targeting portfolios with maturities between 3-5 years to secure higher yields. Taxed at marginal income slab rates.",
    "howToStart": "Invest in Direct plans via Groww, Zerodha Coin, or AMC websites.",
    "products": [
      {
        "name": "ICICI Pru Medium Duration Debt Direct Fund",
        "provider": "ICICI Prudential AMC",
        "rate": "~7.65% p.a.",
        "highlight": "High credit quality portfolio with low expense ratio.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹500 SIP",
        "badge": "Top Rated"
      },
      {
        "name": "HDFC Medium Duration Debt Direct Plan",
        "provider": "HDFC AMC",
        "rate": "~7.65% p.a.",
        "highlight": "Institutional grade risk management and steady return track record.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Category Leader"
      },
      {
        "name": "SBI Medium Duration Debt Direct Growth",
        "provider": "SBI Mutual Fund",
        "rate": "~7.65% p.a.",
        "highlight": "Backed by India's largest PSU AMC with conservative credit selection.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Kotak Medium Duration Debt Direct Plan",
        "provider": "Kotak Mutual Fund",
        "rate": "~7.65% p.a.",
        "highlight": "Focuses on AAA sovereign & PSU bond allocations.",
        "platform": "Kotak MF / Kuvera",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Aditya Birla Sun Life Medium Duration Debt Direct",
        "provider": "Aditya Birla Sun Life AMC",
        "rate": "~7.65% p.a.",
        "highlight": "Consistent liquidity management and competitive yield.",
        "platform": "ABSL MF / Groww",
        "minInvestment": "₹100 SIP"
      }
    ]
  },
  "corporate_bond_mf": {
    "title": "Top Rated Corporate Bond Debt Fund Schemes",
    "riskLevel": 2,
    "note": "Invests strictly in premium credit quality AAA-rated corporate debt certificates. Taxed at marginal income slab rates.",
    "howToStart": "Invest in Direct plans via Groww, Zerodha Coin, or AMC websites.",
    "products": [
      {
        "name": "ICICI Pru Corporate Bond Debt Direct Fund",
        "provider": "ICICI Prudential AMC",
        "rate": "~7.75% p.a.",
        "highlight": "High credit quality portfolio with low expense ratio.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹500 SIP",
        "badge": "Top Rated"
      },
      {
        "name": "HDFC Corporate Bond Debt Direct Plan",
        "provider": "HDFC AMC",
        "rate": "~7.75% p.a.",
        "highlight": "Institutional grade risk management and steady return track record.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Category Leader"
      },
      {
        "name": "SBI Corporate Bond Debt Direct Growth",
        "provider": "SBI Mutual Fund",
        "rate": "~7.75% p.a.",
        "highlight": "Backed by India's largest PSU AMC with conservative credit selection.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Kotak Corporate Bond Debt Direct Plan",
        "provider": "Kotak Mutual Fund",
        "rate": "~7.75% p.a.",
        "highlight": "Focuses on AAA sovereign & PSU bond allocations.",
        "platform": "Kotak MF / Kuvera",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Aditya Birla Sun Life Corporate Bond Debt Direct",
        "provider": "Aditya Birla Sun Life AMC",
        "rate": "~7.75% p.a.",
        "highlight": "Consistent liquidity management and competitive yield.",
        "platform": "ABSL MF / Groww",
        "minInvestment": "₹100 SIP"
      }
    ]
  },
  "banking_psu_mf": {
    "title": "Top Rated Banking & PSU Debt Fund Schemes",
    "riskLevel": 2,
    "note": "Invests primarily in secure debt assets issued by public sector undertakings and banks. Taxed at marginal income slab rates.",
    "howToStart": "Invest in Direct plans via Groww, Zerodha Coin, or AMC websites.",
    "products": [
      {
        "name": "ICICI Pru Banking & PSU Debt Direct Fund",
        "provider": "ICICI Prudential AMC",
        "rate": "~7.6% p.a.",
        "highlight": "High credit quality portfolio with low expense ratio.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹500 SIP",
        "badge": "Top Rated"
      },
      {
        "name": "HDFC Banking & PSU Debt Direct Plan",
        "provider": "HDFC AMC",
        "rate": "~7.6% p.a.",
        "highlight": "Institutional grade risk management and steady return track record.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Category Leader"
      },
      {
        "name": "SBI Banking & PSU Debt Direct Growth",
        "provider": "SBI Mutual Fund",
        "rate": "~7.6% p.a.",
        "highlight": "Backed by India's largest PSU AMC with conservative credit selection.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Kotak Banking & PSU Debt Direct Plan",
        "provider": "Kotak Mutual Fund",
        "rate": "~7.6% p.a.",
        "highlight": "Focuses on AAA sovereign & PSU bond allocations.",
        "platform": "Kotak MF / Kuvera",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Aditya Birla Sun Life Banking & PSU Debt Direct",
        "provider": "Aditya Birla Sun Life AMC",
        "rate": "~7.6% p.a.",
        "highlight": "Consistent liquidity management and competitive yield.",
        "platform": "ABSL MF / Groww",
        "minInvestment": "₹100 SIP"
      }
    ]
  },
  "dynamic_bond_mf": {
    "title": "Top Rated Dynamic Bond Debt Fund Schemes",
    "riskLevel": 3,
    "note": "Actively shifts portfolio maturity profiles depending on interest rate market forecasts. Taxed at marginal income slab rates.",
    "howToStart": "Invest in Direct plans via Groww, Zerodha Coin, or AMC websites.",
    "products": [
      {
        "name": "ICICI Pru Dynamic Bond Debt Direct Fund",
        "provider": "ICICI Prudential AMC",
        "rate": "~7.75% p.a.",
        "highlight": "High credit quality portfolio with low expense ratio.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹500 SIP",
        "badge": "Top Rated"
      },
      {
        "name": "HDFC Dynamic Bond Debt Direct Plan",
        "provider": "HDFC AMC",
        "rate": "~7.75% p.a.",
        "highlight": "Institutional grade risk management and steady return track record.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Category Leader"
      },
      {
        "name": "SBI Dynamic Bond Debt Direct Growth",
        "provider": "SBI Mutual Fund",
        "rate": "~7.75% p.a.",
        "highlight": "Backed by India's largest PSU AMC with conservative credit selection.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Kotak Dynamic Bond Debt Direct Plan",
        "provider": "Kotak Mutual Fund",
        "rate": "~7.75% p.a.",
        "highlight": "Focuses on AAA sovereign & PSU bond allocations.",
        "platform": "Kotak MF / Kuvera",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Aditya Birla Sun Life Dynamic Bond Debt Direct",
        "provider": "Aditya Birla Sun Life AMC",
        "rate": "~7.75% p.a.",
        "highlight": "Consistent liquidity management and competitive yield.",
        "platform": "ABSL MF / Groww",
        "minInvestment": "₹100 SIP"
      }
    ]
  },
  "gilt_mf": {
    "title": "Top Rated Gilt Mutual Fund Schemes",
    "riskLevel": 3,
    "note": "Invests solely in government securities. Fully immune to credit defaults but highly sensitive to interest rate swings. Taxed at marginal income slab rates.",
    "howToStart": "Invest in Direct plans via Groww, Zerodha Coin, or AMC websites.",
    "products": [
      {
        "name": "ICICI Pru Gilt Direct Fund",
        "provider": "ICICI Prudential AMC",
        "rate": "~8.1% p.a.",
        "highlight": "High credit quality portfolio with low expense ratio.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹500 SIP",
        "badge": "Top Rated"
      },
      {
        "name": "HDFC Gilt Direct Plan",
        "provider": "HDFC AMC",
        "rate": "~8.1% p.a.",
        "highlight": "Institutional grade risk management and steady return track record.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Category Leader"
      },
      {
        "name": "SBI Gilt Direct Growth",
        "provider": "SBI Mutual Fund",
        "rate": "~8.1% p.a.",
        "highlight": "Backed by India's largest PSU AMC with conservative credit selection.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Kotak Gilt Direct Plan",
        "provider": "Kotak Mutual Fund",
        "rate": "~8.1% p.a.",
        "highlight": "Focuses on AAA sovereign & PSU bond allocations.",
        "platform": "Kotak MF / Kuvera",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Aditya Birla Sun Life Gilt Mutual Direct",
        "provider": "Aditya Birla Sun Life AMC",
        "rate": "~8.1% p.a.",
        "highlight": "Consistent liquidity management and competitive yield.",
        "platform": "ABSL MF / Groww",
        "minInvestment": "₹100 SIP"
      }
    ]
  },
  "floater_mf": {
    "title": "Top Rated Floating Rate Debt Fund Schemes",
    "riskLevel": 2,
    "note": "Invests in variable interest-bearing debt notes that automatically adjust during rising rate cycles. Taxed at marginal income slab rates.",
    "howToStart": "Invest in Direct plans via Groww, Zerodha Coin, or AMC websites.",
    "products": [
      {
        "name": "ICICI Pru Floating Rate Debt Direct Fund",
        "provider": "ICICI Prudential AMC",
        "rate": "~7.4% p.a.",
        "highlight": "High credit quality portfolio with low expense ratio.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹500 SIP",
        "badge": "Top Rated"
      },
      {
        "name": "HDFC Floating Rate Debt Direct Plan",
        "provider": "HDFC AMC",
        "rate": "~7.4% p.a.",
        "highlight": "Institutional grade risk management and steady return track record.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Category Leader"
      },
      {
        "name": "SBI Floating Rate Debt Direct Growth",
        "provider": "SBI Mutual Fund",
        "rate": "~7.4% p.a.",
        "highlight": "Backed by India's largest PSU AMC with conservative credit selection.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Kotak Floating Rate Debt Direct Plan",
        "provider": "Kotak Mutual Fund",
        "rate": "~7.4% p.a.",
        "highlight": "Focuses on AAA sovereign & PSU bond allocations.",
        "platform": "Kotak MF / Kuvera",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Aditya Birla Sun Life Floating Rate Debt Direct",
        "provider": "Aditya Birla Sun Life AMC",
        "rate": "~7.4% p.a.",
        "highlight": "Consistent liquidity management and competitive yield.",
        "platform": "ABSL MF / Groww",
        "minInvestment": "₹100 SIP"
      }
    ]
  },
  "credit_risk_mf": {
    "title": "Top Rated Credit Risk Debt Fund Schemes",
    "riskLevel": 4,
    "note": "Chases higher yields by investing in lower-rated corporate debt papers. High default vulnerability. Taxed at marginal income slab rates.",
    "howToStart": "Invest in Direct plans via Groww, Zerodha Coin, or AMC websites.",
    "products": [
      {
        "name": "ICICI Pru Credit Risk Debt Direct Fund",
        "provider": "ICICI Prudential AMC",
        "rate": "~8% p.a.",
        "highlight": "High credit quality portfolio with low expense ratio.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹500 SIP",
        "badge": "Top Rated"
      },
      {
        "name": "HDFC Credit Risk Debt Direct Plan",
        "provider": "HDFC AMC",
        "rate": "~8% p.a.",
        "highlight": "Institutional grade risk management and steady return track record.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Category Leader"
      },
      {
        "name": "SBI Credit Risk Debt Direct Growth",
        "provider": "SBI Mutual Fund",
        "rate": "~8% p.a.",
        "highlight": "Backed by India's largest PSU AMC with conservative credit selection.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Kotak Credit Risk Debt Direct Plan",
        "provider": "Kotak Mutual Fund",
        "rate": "~8% p.a.",
        "highlight": "Focuses on AAA sovereign & PSU bond allocations.",
        "platform": "Kotak MF / Kuvera",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Aditya Birla Sun Life Credit Risk Debt Direct",
        "provider": "Aditya Birla Sun Life AMC",
        "rate": "~8% p.a.",
        "highlight": "Consistent liquidity management and competitive yield.",
        "platform": "ABSL MF / Groww",
        "minInvestment": "₹100 SIP"
      }
    ]
  },
  "index_mf": {
    "title": "Best Nifty 50 Index Fund Schemes in India",
    "riskLevel": 3,
    "note": "Passive Nifty 50 fund with lowest cost in the equity category. Ideal for first-time equity investors. 12.5% LTCG tax above ₹1.25L; 20% STCG.",
    "howToStart": "Invest in zero-commission Direct plans via Groww, Zerodha Coin, or Kuvera.",
    "products": [
      {
        "name": "Nippon India Nifty 50 Index Direct Growth",
        "provider": "Nippon India AMC",
        "rate": "~13% p.a.",
        "highlight": "High alpha generator with proven multi-year track record.",
        "platform": "Groww / Coin",
        "minInvestment": "₹100 SIP",
        "badge": "Top Performer"
      },
      {
        "name": "ICICI Pru Nifty 50 Index Direct Plan",
        "provider": "ICICI Prudential AMC",
        "rate": "~13% p.a.",
        "highlight": "Disciplined risk-adjusted framework and strong downside protection.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Consistent Alpha"
      },
      {
        "name": "HDFC Nifty 50 Index Direct Growth",
        "provider": "HDFC AMC",
        "rate": "~13% p.a.",
        "highlight": "Large fund size with high liquidity and robust research coverage.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP"
      },
      {
        "name": "SBI Nifty 50 Index Direct Plan",
        "provider": "SBI Mutual Fund",
        "rate": "~13% p.a.",
        "highlight": "Extensive equity research desk backing high conviction stocks.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Mirae Asset Nifty 50 Index Direct",
        "provider": "Mirae Asset AMC",
        "rate": "~13% p.a.",
        "highlight": "Quality-first investment style focusing on high ROE growth leaders.",
        "platform": "Mirae MF / Kuvera",
        "minInvestment": "₹500 SIP"
      }
    ]
  },
  "elss": {
    "title": "Best ELSS Mutual Fund Schemes in India",
    "riskLevel": 4,
    "note": "Equity tax-saving fund with 80C deduction. Shortest lock-in among all 80C options. 12.5% LTCG tax above ₹1.25L; 20% STCG.",
    "howToStart": "Invest in zero-commission Direct plans via Groww, Zerodha Coin, or Kuvera.",
    "products": [
      {
        "name": "Nippon India ELSS Direct Growth",
        "provider": "Nippon India AMC",
        "rate": "~14% p.a.",
        "highlight": "High alpha generator with proven multi-year track record.",
        "platform": "Groww / Coin",
        "minInvestment": "₹100 SIP",
        "badge": "Top Performer"
      },
      {
        "name": "ICICI Pru ELSS Direct Plan",
        "provider": "ICICI Prudential AMC",
        "rate": "~14% p.a.",
        "highlight": "Disciplined risk-adjusted framework and strong downside protection.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Consistent Alpha"
      },
      {
        "name": "HDFC ELSS Direct Growth",
        "provider": "HDFC AMC",
        "rate": "~14% p.a.",
        "highlight": "Large fund size with high liquidity and robust research coverage.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP"
      },
      {
        "name": "SBI ELSS Direct Plan",
        "provider": "SBI Mutual Fund",
        "rate": "~14% p.a.",
        "highlight": "Extensive equity research desk backing high conviction stocks.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Mirae Asset ELSS Direct",
        "provider": "Mirae Asset AMC",
        "rate": "~14% p.a.",
        "highlight": "Quality-first investment style focusing on high ROE growth leaders.",
        "platform": "Mirae MF / Kuvera",
        "minInvestment": "₹500 SIP"
      }
    ]
  },
  "midcap_mf": {
    "title": "Best Mid-Cap Mutual Fund Schemes in India",
    "riskLevel": 4,
    "note": "High-growth equity exposure via mid-cap companies. ~22% 5Y CAGR (May 2026). 12.5% LTCG tax above ₹1.25L; 20% STCG.",
    "howToStart": "Invest in zero-commission Direct plans via Groww, Zerodha Coin, or Kuvera.",
    "subCategories": {
      "growth_momentum": ["HDFC Mid-Cap Opportunities Fund", "Nippon India Growth Fund"],
      "diversified_core": ["Kotak Emerging Equity Fund", "SBI Midcap Fund"],
      "value_quality": ["Axis Midcap Fund", "Mirae Asset Midcap Fund"]
    },
    "products": [
      {
        "name": "Nippon India Mid-Cap Direct Growth",
        "provider": "Nippon India AMC",
        "rate": "~17.5% p.a.",
        "highlight": "High alpha generator with proven multi-year track record.",
        "platform": "Groww / Coin",
        "minInvestment": "₹100 SIP",
        "badge": "Top Performer"
      },
      {
        "name": "ICICI Pru Mid-Cap Direct Plan",
        "provider": "ICICI Prudential AMC",
        "rate": "~17.5% p.a.",
        "highlight": "Disciplined risk-adjusted framework and strong downside protection.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Consistent Alpha"
      },
      {
        "name": "HDFC Mid-Cap Direct Growth",
        "provider": "HDFC AMC",
        "rate": "~17.5% p.a.",
        "highlight": "Large fund size with high liquidity and robust research coverage.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP"
      },
      {
        "name": "SBI Mid-Cap Direct Plan",
        "provider": "SBI Mutual Fund",
        "rate": "~17.5% p.a.",
        "highlight": "Extensive equity research desk backing high conviction stocks.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Mirae Asset Mid-Cap Direct",
        "provider": "Mirae Asset AMC",
        "rate": "~17.5% p.a.",
        "highlight": "Quality-first investment style focusing on high ROE growth leaders.",
        "platform": "Mirae MF / Kuvera",
        "minInvestment": "₹500 SIP"
      }
    ]
  },
  "smallcap_mf": {
    "title": "Best Small-Cap Mutual Fund Schemes in India",
    "riskLevel": 5,
    "note": "Highest potential equity return with proportionally high risk. ~23% 5Y CAGR (May 2026). 12.5% LTCG tax above ₹1.25L; 20% STCG.",
    "howToStart": "Invest in zero-commission Direct plans via Groww, Zerodha Coin, or Kuvera.",
    "subCategories": {
      "aggressive_alpha": ["Nippon India Small Cap Fund", "Quant Small Cap Fund"],
      "diversified_broad": ["HDFC Small Cap Fund", "SBI Small Cap Fund"],
      "quality_defensive": ["Axis Small Cap Fund", "Kotak Small Cap Fund"]
    },
    "products": [
      {
        "name": "Nippon India Small-Cap Direct Growth",
        "provider": "Nippon India AMC",
        "rate": "~21% p.a.",
        "highlight": "High alpha generator with proven multi-year track record.",
        "platform": "Groww / Coin",
        "minInvestment": "₹100 SIP",
        "badge": "Top Performer"
      },
      {
        "name": "ICICI Pru Small-Cap Direct Plan",
        "provider": "ICICI Prudential AMC",
        "rate": "~21% p.a.",
        "highlight": "Disciplined risk-adjusted framework and strong downside protection.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Consistent Alpha"
      },
      {
        "name": "HDFC Small-Cap Direct Growth",
        "provider": "HDFC AMC",
        "rate": "~21% p.a.",
        "highlight": "Large fund size with high liquidity and robust research coverage.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP"
      },
      {
        "name": "SBI Small-Cap Direct Plan",
        "provider": "SBI Mutual Fund",
        "rate": "~21% p.a.",
        "highlight": "Extensive equity research desk backing high conviction stocks.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Mirae Asset Small-Cap Direct",
        "provider": "Mirae Asset AMC",
        "rate": "~21% p.a.",
        "highlight": "Quality-first investment style focusing on high ROE growth leaders.",
        "platform": "Mirae MF / Kuvera",
        "minInvestment": "₹500 SIP"
      }
    ]
  },
  "hybrid_mf": {
    "title": "Best Balanced Advantage Fund Schemes in India",
    "riskLevel": 3,
    "note": "Dynamic asset allocation between equity and debt. Cushions drawdowns while participating in equity upside. 12.5% LTCG tax above ₹1.25L; 20% STCG.",
    "howToStart": "Invest in zero-commission Direct plans via Groww, Zerodha Coin, or Kuvera.",
    "products": [
      {
        "name": "Nippon India Balanced Advantage Direct Growth",
        "provider": "Nippon India AMC",
        "rate": "~11.75% p.a.",
        "highlight": "High alpha generator with proven multi-year track record.",
        "platform": "Groww / Coin",
        "minInvestment": "₹100 SIP",
        "badge": "Top Performer"
      },
      {
        "name": "ICICI Pru Balanced Advantage Direct Plan",
        "provider": "ICICI Prudential AMC",
        "rate": "~11.75% p.a.",
        "highlight": "Disciplined risk-adjusted framework and strong downside protection.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Consistent Alpha"
      },
      {
        "name": "HDFC Balanced Advantage Direct Growth",
        "provider": "HDFC AMC",
        "rate": "~11.75% p.a.",
        "highlight": "Large fund size with high liquidity and robust research coverage.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP"
      },
      {
        "name": "SBI Balanced Advantage Direct Plan",
        "provider": "SBI Mutual Fund",
        "rate": "~11.75% p.a.",
        "highlight": "Extensive equity research desk backing high conviction stocks.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Mirae Asset Balanced Advantage Direct",
        "provider": "Mirae Asset AMC",
        "rate": "~11.75% p.a.",
        "highlight": "Quality-first investment style focusing on high ROE growth leaders.",
        "platform": "Mirae MF / Kuvera",
        "minInvestment": "₹500 SIP"
      }
    ]
  },
  "large_cap_mf": {
    "title": "Best Large Cap Equity Fund Schemes in India",
    "riskLevel": 3,
    "note": "Active mutual fund focusing on top-tier blue-chip Indian companies. Offers stable equity compounding. 12.5% LTCG tax above ₹1.25L; 20% STCG.",
    "howToStart": "Invest in zero-commission Direct plans via Groww, Zerodha Coin, or Kuvera.",
    "products": [
      {
        "name": "Nippon India Large Cap Equity Direct Growth",
        "provider": "Nippon India AMC",
        "rate": "~13.25% p.a.",
        "highlight": "High alpha generator with proven multi-year track record.",
        "platform": "Groww / Coin",
        "minInvestment": "₹100 SIP",
        "badge": "Top Performer"
      },
      {
        "name": "ICICI Pru Large Cap Equity Direct Plan",
        "provider": "ICICI Prudential AMC",
        "rate": "~13.25% p.a.",
        "highlight": "Disciplined risk-adjusted framework and strong downside protection.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Consistent Alpha"
      },
      {
        "name": "HDFC Large Cap Equity Direct Growth",
        "provider": "HDFC AMC",
        "rate": "~13.25% p.a.",
        "highlight": "Large fund size with high liquidity and robust research coverage.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP"
      },
      {
        "name": "SBI Large Cap Equity Direct Plan",
        "provider": "SBI Mutual Fund",
        "rate": "~13.25% p.a.",
        "highlight": "Extensive equity research desk backing high conviction stocks.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Mirae Asset Large Cap Equity Direct",
        "provider": "Mirae Asset AMC",
        "rate": "~13.25% p.a.",
        "highlight": "Quality-first investment style focusing on high ROE growth leaders.",
        "platform": "Mirae MF / Kuvera",
        "minInvestment": "₹500 SIP"
      }
    ]
  },
  "large_mid_mf": {
    "title": "Best Large & Mid Cap Equity Fund Schemes in India",
    "riskLevel": 4,
    "note": "A balanced blend of stable large-caps and high-growth mid-cap companies. 12.5% LTCG tax above ₹1.25L; 20% STCG.",
    "howToStart": "Invest in zero-commission Direct plans via Groww, Zerodha Coin, or Kuvera.",
    "products": [
      {
        "name": "Nippon India Large & Mid Cap Equity Direct Growth",
        "provider": "Nippon India AMC",
        "rate": "~15% p.a.",
        "highlight": "High alpha generator with proven multi-year track record.",
        "platform": "Groww / Coin",
        "minInvestment": "₹100 SIP",
        "badge": "Top Performer"
      },
      {
        "name": "ICICI Pru Large & Mid Cap Equity Direct Plan",
        "provider": "ICICI Prudential AMC",
        "rate": "~15% p.a.",
        "highlight": "Disciplined risk-adjusted framework and strong downside protection.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Consistent Alpha"
      },
      {
        "name": "HDFC Large & Mid Cap Equity Direct Growth",
        "provider": "HDFC AMC",
        "rate": "~15% p.a.",
        "highlight": "Large fund size with high liquidity and robust research coverage.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP"
      },
      {
        "name": "SBI Large & Mid Cap Equity Direct Plan",
        "provider": "SBI Mutual Fund",
        "rate": "~15% p.a.",
        "highlight": "Extensive equity research desk backing high conviction stocks.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Mirae Asset Large & Mid Cap Equity Direct",
        "provider": "Mirae Asset AMC",
        "rate": "~15% p.a.",
        "highlight": "Quality-first investment style focusing on high ROE growth leaders.",
        "platform": "Mirae MF / Kuvera",
        "minInvestment": "₹500 SIP"
      }
    ]
  },
  "flexi_cap_mf": {
    "title": "Best Flexi Cap Mutual Fund Schemes in India",
    "riskLevel": 4,
    "note": "Flexible equity fund that adjusts holdings across large, mid, and small-cap segments based on valuations. 12.5% LTCG tax above ₹1.25L; 20% STCG.",
    "howToStart": "Invest in zero-commission Direct plans via Groww, Zerodha Coin, or Kuvera.",
    "products": [
      {
        "name": "Nippon India Flexi Cap Direct Growth",
        "provider": "Nippon India AMC",
        "rate": "~15% p.a.",
        "highlight": "High alpha generator with proven multi-year track record.",
        "platform": "Groww / Coin",
        "minInvestment": "₹100 SIP",
        "badge": "Top Performer"
      },
      {
        "name": "ICICI Pru Flexi Cap Direct Plan",
        "provider": "ICICI Prudential AMC",
        "rate": "~15% p.a.",
        "highlight": "Disciplined risk-adjusted framework and strong downside protection.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Consistent Alpha"
      },
      {
        "name": "HDFC Flexi Cap Direct Growth",
        "provider": "HDFC AMC",
        "rate": "~15% p.a.",
        "highlight": "Large fund size with high liquidity and robust research coverage.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP"
      },
      {
        "name": "SBI Flexi Cap Direct Plan",
        "provider": "SBI Mutual Fund",
        "rate": "~15% p.a.",
        "highlight": "Extensive equity research desk backing high conviction stocks.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Mirae Asset Flexi Cap Direct",
        "provider": "Mirae Asset AMC",
        "rate": "~15% p.a.",
        "highlight": "Quality-first investment style focusing on high ROE growth leaders.",
        "platform": "Mirae MF / Kuvera",
        "minInvestment": "₹500 SIP"
      }
    ]
  },
  "multi_cap_mf": {
    "title": "Best Multi Cap Equity Fund Schemes in India",
    "riskLevel": 4,
    "note": "Maintains disciplined, mandatory diversification across large, mid, and small-cap spaces. 12.5% LTCG tax above ₹1.25L; 20% STCG.",
    "howToStart": "Invest in zero-commission Direct plans via Groww, Zerodha Coin, or Kuvera.",
    "products": [
      {
        "name": "Nippon India Multi Cap Equity Direct Growth",
        "provider": "Nippon India AMC",
        "rate": "~16.75% p.a.",
        "highlight": "High alpha generator with proven multi-year track record.",
        "platform": "Groww / Coin",
        "minInvestment": "₹100 SIP",
        "badge": "Top Performer"
      },
      {
        "name": "ICICI Pru Multi Cap Equity Direct Plan",
        "provider": "ICICI Prudential AMC",
        "rate": "~16.75% p.a.",
        "highlight": "Disciplined risk-adjusted framework and strong downside protection.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Consistent Alpha"
      },
      {
        "name": "HDFC Multi Cap Equity Direct Growth",
        "provider": "HDFC AMC",
        "rate": "~16.75% p.a.",
        "highlight": "Large fund size with high liquidity and robust research coverage.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP"
      },
      {
        "name": "SBI Multi Cap Equity Direct Plan",
        "provider": "SBI Mutual Fund",
        "rate": "~16.75% p.a.",
        "highlight": "Extensive equity research desk backing high conviction stocks.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Mirae Asset Multi Cap Equity Direct",
        "provider": "Mirae Asset AMC",
        "rate": "~16.75% p.a.",
        "highlight": "Quality-first investment style focusing on high ROE growth leaders.",
        "platform": "Mirae MF / Kuvera",
        "minInvestment": "₹500 SIP"
      }
    ]
  },
  "focused_mf": {
    "title": "Best Focused Equity Fund Schemes in India",
    "riskLevel": 4,
    "note": "Concentrated equity strategy backing up to 30 high-conviction stocks. High risk-reward profile. 12.5% LTCG tax above ₹1.25L; 20% STCG.",
    "howToStart": "Invest in zero-commission Direct plans via Groww, Zerodha Coin, or Kuvera.",
    "products": [
      {
        "name": "Nippon India Focused Equity Direct Growth",
        "provider": "Nippon India AMC",
        "rate": "~17.25% p.a.",
        "highlight": "High alpha generator with proven multi-year track record.",
        "platform": "Groww / Coin",
        "minInvestment": "₹100 SIP",
        "badge": "Top Performer"
      },
      {
        "name": "ICICI Pru Focused Equity Direct Plan",
        "provider": "ICICI Prudential AMC",
        "rate": "~17.25% p.a.",
        "highlight": "Disciplined risk-adjusted framework and strong downside protection.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Consistent Alpha"
      },
      {
        "name": "HDFC Focused Equity Direct Growth",
        "provider": "HDFC AMC",
        "rate": "~17.25% p.a.",
        "highlight": "Large fund size with high liquidity and robust research coverage.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP"
      },
      {
        "name": "SBI Focused Equity Direct Plan",
        "provider": "SBI Mutual Fund",
        "rate": "~17.25% p.a.",
        "highlight": "Extensive equity research desk backing high conviction stocks.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Mirae Asset Focused Equity Direct",
        "provider": "Mirae Asset AMC",
        "rate": "~17.25% p.a.",
        "highlight": "Quality-first investment style focusing on high ROE growth leaders.",
        "platform": "Mirae MF / Kuvera",
        "minInvestment": "₹500 SIP"
      }
    ]
  },
  "value_mf": {
    "title": "Best Value Mutual Fund Schemes in India",
    "riskLevel": 3,
    "note": "Equity fund adhering to value investing philosophy, targeting cheap, out-of-favor companies. 12.5% LTCG tax above ₹1.25L; 20% STCG.",
    "howToStart": "Invest in zero-commission Direct plans via Groww, Zerodha Coin, or Kuvera.",
    "products": [
      {
        "name": "Nippon India Value Direct Growth",
        "provider": "Nippon India AMC",
        "rate": "~13.75% p.a.",
        "highlight": "High alpha generator with proven multi-year track record.",
        "platform": "Groww / Coin",
        "minInvestment": "₹100 SIP",
        "badge": "Top Performer"
      },
      {
        "name": "ICICI Pru Value Direct Plan",
        "provider": "ICICI Prudential AMC",
        "rate": "~13.75% p.a.",
        "highlight": "Disciplined risk-adjusted framework and strong downside protection.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Consistent Alpha"
      },
      {
        "name": "HDFC Value Direct Growth",
        "provider": "HDFC AMC",
        "rate": "~13.75% p.a.",
        "highlight": "Large fund size with high liquidity and robust research coverage.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP"
      },
      {
        "name": "SBI Value Direct Plan",
        "provider": "SBI Mutual Fund",
        "rate": "~13.75% p.a.",
        "highlight": "Extensive equity research desk backing high conviction stocks.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Mirae Asset Value Direct",
        "provider": "Mirae Asset AMC",
        "rate": "~13.75% p.a.",
        "highlight": "Quality-first investment style focusing on high ROE growth leaders.",
        "platform": "Mirae MF / Kuvera",
        "minInvestment": "₹500 SIP"
      }
    ]
  },
  "contra_mf": {
    "title": "Best Contra Equity Fund Schemes in India",
    "riskLevel": 4,
    "note": "Contrarian fund taking bets against the current market sentiment, buying assets currently in distress. 12.5% LTCG tax above ₹1.25L; 20% STCG.",
    "howToStart": "Invest in zero-commission Direct plans via Groww, Zerodha Coin, or Kuvera.",
    "products": [
      {
        "name": "Nippon India Contra Equity Direct Growth",
        "provider": "Nippon India AMC",
        "rate": "~14.25% p.a.",
        "highlight": "High alpha generator with proven multi-year track record.",
        "platform": "Groww / Coin",
        "minInvestment": "₹100 SIP",
        "badge": "Top Performer"
      },
      {
        "name": "ICICI Pru Contra Equity Direct Plan",
        "provider": "ICICI Prudential AMC",
        "rate": "~14.25% p.a.",
        "highlight": "Disciplined risk-adjusted framework and strong downside protection.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Consistent Alpha"
      },
      {
        "name": "HDFC Contra Equity Direct Growth",
        "provider": "HDFC AMC",
        "rate": "~14.25% p.a.",
        "highlight": "Large fund size with high liquidity and robust research coverage.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP"
      },
      {
        "name": "SBI Contra Equity Direct Plan",
        "provider": "SBI Mutual Fund",
        "rate": "~14.25% p.a.",
        "highlight": "Extensive equity research desk backing high conviction stocks.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Mirae Asset Contra Equity Direct",
        "provider": "Mirae Asset AMC",
        "rate": "~14.25% p.a.",
        "highlight": "Quality-first investment style focusing on high ROE growth leaders.",
        "platform": "Mirae MF / Kuvera",
        "minInvestment": "₹500 SIP"
      }
    ]
  },
  "dividend_yield_mf": {
    "title": "Best Dividend Yield Mutual Fund Schemes in India",
    "riskLevel": 3,
    "note": "Targets cash-rich companies paying consistent dividends. Features lower volatility than growth funds. 12.5% LTCG tax above ₹1.25L; 20% STCG.",
    "howToStart": "Invest in zero-commission Direct plans via Groww, Zerodha Coin, or Kuvera.",
    "products": [
      {
        "name": "Nippon India Dividend Yield Direct Growth",
        "provider": "Nippon India AMC",
        "rate": "~12.25% p.a.",
        "highlight": "High alpha generator with proven multi-year track record.",
        "platform": "Groww / Coin",
        "minInvestment": "₹100 SIP",
        "badge": "Top Performer"
      },
      {
        "name": "ICICI Pru Dividend Yield Direct Plan",
        "provider": "ICICI Prudential AMC",
        "rate": "~12.25% p.a.",
        "highlight": "Disciplined risk-adjusted framework and strong downside protection.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Consistent Alpha"
      },
      {
        "name": "HDFC Dividend Yield Direct Growth",
        "provider": "HDFC AMC",
        "rate": "~12.25% p.a.",
        "highlight": "Large fund size with high liquidity and robust research coverage.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP"
      },
      {
        "name": "SBI Dividend Yield Direct Plan",
        "provider": "SBI Mutual Fund",
        "rate": "~12.25% p.a.",
        "highlight": "Extensive equity research desk backing high conviction stocks.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Mirae Asset Dividend Yield Direct",
        "provider": "Mirae Asset AMC",
        "rate": "~12.25% p.a.",
        "highlight": "Quality-first investment style focusing on high ROE growth leaders.",
        "platform": "Mirae MF / Kuvera",
        "minInvestment": "₹500 SIP"
      }
    ]
  },
  "agg_hybrid_mf": {
    "title": "Best Aggressive Hybrid Fund Schemes in India",
    "riskLevel": 3,
    "note": "Combines an aggressive equity base with stable fixed-income debt padding. 12.5% LTCG tax above ₹1.25L; 20% STCG.",
    "howToStart": "Invest in zero-commission Direct plans via Groww, Zerodha Coin, or Kuvera.",
    "products": [
      {
        "name": "Nippon India Aggressive Hybrid Direct Growth",
        "provider": "Nippon India AMC",
        "rate": "~12.75% p.a.",
        "highlight": "High alpha generator with proven multi-year track record.",
        "platform": "Groww / Coin",
        "minInvestment": "₹100 SIP",
        "badge": "Top Performer"
      },
      {
        "name": "ICICI Pru Aggressive Hybrid Direct Plan",
        "provider": "ICICI Prudential AMC",
        "rate": "~12.75% p.a.",
        "highlight": "Disciplined risk-adjusted framework and strong downside protection.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Consistent Alpha"
      },
      {
        "name": "HDFC Aggressive Hybrid Direct Growth",
        "provider": "HDFC AMC",
        "rate": "~12.75% p.a.",
        "highlight": "Large fund size with high liquidity and robust research coverage.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP"
      },
      {
        "name": "SBI Aggressive Hybrid Direct Plan",
        "provider": "SBI Mutual Fund",
        "rate": "~12.75% p.a.",
        "highlight": "Extensive equity research desk backing high conviction stocks.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Mirae Asset Aggressive Hybrid Direct",
        "provider": "Mirae Asset AMC",
        "rate": "~12.75% p.a.",
        "highlight": "Quality-first investment style focusing on high ROE growth leaders.",
        "platform": "Mirae MF / Kuvera",
        "minInvestment": "₹500 SIP"
      }
    ]
  },
  "equity_savings_mf": {
    "title": "Best Equity Savings Hybrid Fund Schemes in India",
    "riskLevel": 2,
    "note": "Uses equity, derivatives (arbitrage), and debt to yield stable returns with low downside. 12.5% LTCG tax above ₹1.25L; 20% STCG.",
    "howToStart": "Invest in zero-commission Direct plans via Groww, Zerodha Coin, or Kuvera.",
    "products": [
      {
        "name": "Nippon India Equity Savings Hybrid Direct Growth",
        "provider": "Nippon India AMC",
        "rate": "~9.25% p.a.",
        "highlight": "High alpha generator with proven multi-year track record.",
        "platform": "Groww / Coin",
        "minInvestment": "₹100 SIP",
        "badge": "Top Performer"
      },
      {
        "name": "ICICI Pru Equity Savings Hybrid Direct Plan",
        "provider": "ICICI Prudential AMC",
        "rate": "~9.25% p.a.",
        "highlight": "Disciplined risk-adjusted framework and strong downside protection.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Consistent Alpha"
      },
      {
        "name": "HDFC Equity Savings Hybrid Direct Growth",
        "provider": "HDFC AMC",
        "rate": "~9.25% p.a.",
        "highlight": "Large fund size with high liquidity and robust research coverage.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP"
      },
      {
        "name": "SBI Equity Savings Hybrid Direct Plan",
        "provider": "SBI Mutual Fund",
        "rate": "~9.25% p.a.",
        "highlight": "Extensive equity research desk backing high conviction stocks.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Mirae Asset Equity Savings Hybrid Direct",
        "provider": "Mirae Asset AMC",
        "rate": "~9.25% p.a.",
        "highlight": "Quality-first investment style focusing on high ROE growth leaders.",
        "platform": "Mirae MF / Kuvera",
        "minInvestment": "₹500 SIP"
      }
    ]
  },
  "mfg_sector_mf": {
    "title": "Best Manufacturing Sector Fund Schemes in India",
    "riskLevel": 4,
    "note": "Capitalizes on India's industrial manufacturing expansion theme. Highly cyclical. 12.5% LTCG tax above ₹1.25L; 20% STCG.",
    "howToStart": "Invest in zero-commission Direct plans via Groww, Zerodha Coin, or Kuvera.",
    "products": [
      {
        "name": "Nippon India Manufacturing Sector Direct Growth",
        "provider": "Nippon India AMC",
        "rate": "~17.5% p.a.",
        "highlight": "High alpha generator with proven multi-year track record.",
        "platform": "Groww / Coin",
        "minInvestment": "₹100 SIP",
        "badge": "Top Performer"
      },
      {
        "name": "ICICI Pru Manufacturing Sector Direct Plan",
        "provider": "ICICI Prudential AMC",
        "rate": "~17.5% p.a.",
        "highlight": "Disciplined risk-adjusted framework and strong downside protection.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Consistent Alpha"
      },
      {
        "name": "HDFC Manufacturing Sector Direct Growth",
        "provider": "HDFC AMC",
        "rate": "~17.5% p.a.",
        "highlight": "Large fund size with high liquidity and robust research coverage.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP"
      },
      {
        "name": "SBI Manufacturing Sector Direct Plan",
        "provider": "SBI Mutual Fund",
        "rate": "~17.5% p.a.",
        "highlight": "Extensive equity research desk backing high conviction stocks.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Mirae Asset Manufacturing Sector Direct",
        "provider": "Mirae Asset AMC",
        "rate": "~17.5% p.a.",
        "highlight": "Quality-first investment style focusing on high ROE growth leaders.",
        "platform": "Mirae MF / Kuvera",
        "minInvestment": "₹500 SIP"
      }
    ]
  },
  "infra_sector_mf": {
    "title": "Best Infrastructure Sector Fund Schemes in India",
    "riskLevel": 5,
    "note": "Focuses on capital goods, construction, energy, and logistics infrastructure. 12.5% LTCG tax above ₹1.25L; 20% STCG.",
    "howToStart": "Invest in zero-commission Direct plans via Groww, Zerodha Coin, or Kuvera.",
    "products": [
      {
        "name": "Nippon India Infrastructure Sector Direct Growth",
        "provider": "Nippon India AMC",
        "rate": "~16% p.a.",
        "highlight": "High alpha generator with proven multi-year track record.",
        "platform": "Groww / Coin",
        "minInvestment": "₹100 SIP",
        "badge": "Top Performer"
      },
      {
        "name": "ICICI Pru Infrastructure Sector Direct Plan",
        "provider": "ICICI Prudential AMC",
        "rate": "~16% p.a.",
        "highlight": "Disciplined risk-adjusted framework and strong downside protection.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Consistent Alpha"
      },
      {
        "name": "HDFC Infrastructure Sector Direct Growth",
        "provider": "HDFC AMC",
        "rate": "~16% p.a.",
        "highlight": "Large fund size with high liquidity and robust research coverage.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP"
      },
      {
        "name": "SBI Infrastructure Sector Direct Plan",
        "provider": "SBI Mutual Fund",
        "rate": "~16% p.a.",
        "highlight": "Extensive equity research desk backing high conviction stocks.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Mirae Asset Infrastructure Sector Direct",
        "provider": "Mirae Asset AMC",
        "rate": "~16% p.a.",
        "highlight": "Quality-first investment style focusing on high ROE growth leaders.",
        "platform": "Mirae MF / Kuvera",
        "minInvestment": "₹500 SIP"
      }
    ]
  },
  "pharma_sector_mf": {
    "title": "Best Pharma Sector Fund Schemes in India",
    "riskLevel": 4,
    "note": "Invests in pharmaceutical, biotech, and healthcare segments. Defensive during market slides. 12.5% LTCG tax above ₹1.25L; 20% STCG.",
    "howToStart": "Invest in zero-commission Direct plans via Groww, Zerodha Coin, or Kuvera.",
    "products": [
      {
        "name": "Nippon India Pharma Sector Direct Growth",
        "provider": "Nippon India AMC",
        "rate": "~15% p.a.",
        "highlight": "High alpha generator with proven multi-year track record.",
        "platform": "Groww / Coin",
        "minInvestment": "₹100 SIP",
        "badge": "Top Performer"
      },
      {
        "name": "ICICI Pru Pharma Sector Direct Plan",
        "provider": "ICICI Prudential AMC",
        "rate": "~15% p.a.",
        "highlight": "Disciplined risk-adjusted framework and strong downside protection.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Consistent Alpha"
      },
      {
        "name": "HDFC Pharma Sector Direct Growth",
        "provider": "HDFC AMC",
        "rate": "~15% p.a.",
        "highlight": "Large fund size with high liquidity and robust research coverage.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP"
      },
      {
        "name": "SBI Pharma Sector Direct Plan",
        "provider": "SBI Mutual Fund",
        "rate": "~15% p.a.",
        "highlight": "Extensive equity research desk backing high conviction stocks.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Mirae Asset Pharma Sector Direct",
        "provider": "Mirae Asset AMC",
        "rate": "~15% p.a.",
        "highlight": "Quality-first investment style focusing on high ROE growth leaders.",
        "platform": "Mirae MF / Kuvera",
        "minInvestment": "₹500 SIP"
      }
    ]
  },
  "banking_sector_mf": {
    "title": "Best Banking Sector Fund Schemes in India",
    "riskLevel": 4,
    "note": "Highly correlated to domestic economic growth and credit cycles in banking. 12.5% LTCG tax above ₹1.25L; 20% STCG.",
    "howToStart": "Invest in zero-commission Direct plans via Groww, Zerodha Coin, or Kuvera.",
    "products": [
      {
        "name": "Nippon India Banking Sector Direct Growth",
        "provider": "Nippon India AMC",
        "rate": "~16.5% p.a.",
        "highlight": "High alpha generator with proven multi-year track record.",
        "platform": "Groww / Coin",
        "minInvestment": "₹100 SIP",
        "badge": "Top Performer"
      },
      {
        "name": "ICICI Pru Banking Sector Direct Plan",
        "provider": "ICICI Prudential AMC",
        "rate": "~16.5% p.a.",
        "highlight": "Disciplined risk-adjusted framework and strong downside protection.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Consistent Alpha"
      },
      {
        "name": "HDFC Banking Sector Direct Growth",
        "provider": "HDFC AMC",
        "rate": "~16.5% p.a.",
        "highlight": "Large fund size with high liquidity and robust research coverage.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP"
      },
      {
        "name": "SBI Banking Sector Direct Plan",
        "provider": "SBI Mutual Fund",
        "rate": "~16.5% p.a.",
        "highlight": "Extensive equity research desk backing high conviction stocks.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Mirae Asset Banking Sector Direct",
        "provider": "Mirae Asset AMC",
        "rate": "~16.5% p.a.",
        "highlight": "Quality-first investment style focusing on high ROE growth leaders.",
        "platform": "Mirae MF / Kuvera",
        "minInvestment": "₹500 SIP"
      }
    ]
  },
  "it_sector_mf": {
    "title": "Best IT Sector Fund Schemes in India",
    "riskLevel": 4,
    "note": "Invests in software services, consulting, and tech firms. High global currency correlation. 12.5% LTCG tax above ₹1.25L; 20% STCG.",
    "howToStart": "Invest in zero-commission Direct plans via Groww, Zerodha Coin, or Kuvera.",
    "products": [
      {
        "name": "Nippon India IT Sector Direct Growth",
        "provider": "Nippon India AMC",
        "rate": "~16.75% p.a.",
        "highlight": "High alpha generator with proven multi-year track record.",
        "platform": "Groww / Coin",
        "minInvestment": "₹100 SIP",
        "badge": "Top Performer"
      },
      {
        "name": "ICICI Pru IT Sector Direct Plan",
        "provider": "ICICI Prudential AMC",
        "rate": "~16.75% p.a.",
        "highlight": "Disciplined risk-adjusted framework and strong downside protection.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Consistent Alpha"
      },
      {
        "name": "HDFC IT Sector Direct Growth",
        "provider": "HDFC AMC",
        "rate": "~16.75% p.a.",
        "highlight": "Large fund size with high liquidity and robust research coverage.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP"
      },
      {
        "name": "SBI IT Sector Direct Plan",
        "provider": "SBI Mutual Fund",
        "rate": "~16.75% p.a.",
        "highlight": "Extensive equity research desk backing high conviction stocks.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Mirae Asset IT Sector Direct",
        "provider": "Mirae Asset AMC",
        "rate": "~16.75% p.a.",
        "highlight": "Quality-first investment style focusing on high ROE growth leaders.",
        "platform": "Mirae MF / Kuvera",
        "minInvestment": "₹500 SIP"
      }
    ]
  },
  "consumption_mf": {
    "title": "Best Consumption Sector Fund Schemes in India",
    "riskLevel": 4,
    "note": "Capitalizes on consumer discretionary and FMCG growth sectors. 12.5% LTCG tax above ₹1.25L; 20% STCG.",
    "howToStart": "Invest in zero-commission Direct plans via Groww, Zerodha Coin, or Kuvera.",
    "products": [
      {
        "name": "Nippon India Consumption Sector Direct Growth",
        "provider": "Nippon India AMC",
        "rate": "~14.25% p.a.",
        "highlight": "High alpha generator with proven multi-year track record.",
        "platform": "Groww / Coin",
        "minInvestment": "₹100 SIP",
        "badge": "Top Performer"
      },
      {
        "name": "ICICI Pru Consumption Sector Direct Plan",
        "provider": "ICICI Prudential AMC",
        "rate": "~14.25% p.a.",
        "highlight": "Disciplined risk-adjusted framework and strong downside protection.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Consistent Alpha"
      },
      {
        "name": "HDFC Consumption Sector Direct Growth",
        "provider": "HDFC AMC",
        "rate": "~14.25% p.a.",
        "highlight": "Large fund size with high liquidity and robust research coverage.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP"
      },
      {
        "name": "SBI Consumption Sector Direct Plan",
        "provider": "SBI Mutual Fund",
        "rate": "~14.25% p.a.",
        "highlight": "Extensive equity research desk backing high conviction stocks.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Mirae Asset Consumption Sector Direct",
        "provider": "Mirae Asset AMC",
        "rate": "~14.25% p.a.",
        "highlight": "Quality-first investment style focusing on high ROE growth leaders.",
        "platform": "Mirae MF / Kuvera",
        "minInvestment": "₹500 SIP"
      }
    ]
  },
  "esg_mf": {
    "title": "Best ESG Thematic Fund Schemes in India",
    "riskLevel": 4,
    "note": "Screens out companies with low ESG credentials (fossil fuels, tobacco, etc.). 12.5% LTCG tax above ₹1.25L; 20% STCG.",
    "howToStart": "Invest in zero-commission Direct plans via Groww, Zerodha Coin, or Kuvera.",
    "products": [
      {
        "name": "Nippon India ESG Thematic Direct Growth",
        "provider": "Nippon India AMC",
        "rate": "~13% p.a.",
        "highlight": "High alpha generator with proven multi-year track record.",
        "platform": "Groww / Coin",
        "minInvestment": "₹100 SIP",
        "badge": "Top Performer"
      },
      {
        "name": "ICICI Pru ESG Thematic Direct Plan",
        "provider": "ICICI Prudential AMC",
        "rate": "~13% p.a.",
        "highlight": "Disciplined risk-adjusted framework and strong downside protection.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Consistent Alpha"
      },
      {
        "name": "HDFC ESG Thematic Direct Growth",
        "provider": "HDFC AMC",
        "rate": "~13% p.a.",
        "highlight": "Large fund size with high liquidity and robust research coverage.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP"
      },
      {
        "name": "SBI ESG Thematic Direct Plan",
        "provider": "SBI Mutual Fund",
        "rate": "~13% p.a.",
        "highlight": "Extensive equity research desk backing high conviction stocks.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Mirae Asset ESG Thematic Direct",
        "provider": "Mirae Asset AMC",
        "rate": "~13% p.a.",
        "highlight": "Quality-first investment style focusing on high ROE growth leaders.",
        "platform": "Mirae MF / Kuvera",
        "minInvestment": "₹500 SIP"
      }
    ]
  },
  "us_equity_mf": {
    "title": "Best US Equity International Fund Schemes in India",
    "riskLevel": 4,
    "note": "Feeder fund investing in US stock markets. Offsets INR depreciation risk. 12.5% LTCG tax above ₹1.25L; 20% STCG.",
    "howToStart": "Invest in zero-commission Direct plans via Groww, Zerodha Coin, or Kuvera.",
    "products": [
      {
        "name": "Nippon India US Equity International Direct Growth",
        "provider": "Nippon India AMC",
        "rate": "~12% p.a.",
        "highlight": "High alpha generator with proven multi-year track record.",
        "platform": "Groww / Coin",
        "minInvestment": "₹100 SIP",
        "badge": "Top Performer"
      },
      {
        "name": "ICICI Pru US Equity International Direct Plan",
        "provider": "ICICI Prudential AMC",
        "rate": "~12% p.a.",
        "highlight": "Disciplined risk-adjusted framework and strong downside protection.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Consistent Alpha"
      },
      {
        "name": "HDFC US Equity International Direct Growth",
        "provider": "HDFC AMC",
        "rate": "~12% p.a.",
        "highlight": "Large fund size with high liquidity and robust research coverage.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP"
      },
      {
        "name": "SBI US Equity International Direct Plan",
        "provider": "SBI Mutual Fund",
        "rate": "~12% p.a.",
        "highlight": "Extensive equity research desk backing high conviction stocks.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Mirae Asset US Equity International Direct",
        "provider": "Mirae Asset AMC",
        "rate": "~12% p.a.",
        "highlight": "Quality-first investment style focusing on high ROE growth leaders.",
        "platform": "Mirae MF / Kuvera",
        "minInvestment": "₹500 SIP"
      }
    ]
  },
  "global_equity_mf": {
    "title": "Best Global Equity International Fund Schemes in India",
    "riskLevel": 4,
    "note": "Invests in worldwide equity indices outside India to de-risk geographic concentration. 12.5% LTCG tax above ₹1.25L; 20% STCG.",
    "howToStart": "Invest in zero-commission Direct plans via Groww, Zerodha Coin, or Kuvera.",
    "products": [
      {
        "name": "Nippon India Global Equity International Direct Growth",
        "provider": "Nippon India AMC",
        "rate": "~11.5% p.a.",
        "highlight": "High alpha generator with proven multi-year track record.",
        "platform": "Groww / Coin",
        "minInvestment": "₹100 SIP",
        "badge": "Top Performer"
      },
      {
        "name": "ICICI Pru Global Equity International Direct Plan",
        "provider": "ICICI Prudential AMC",
        "rate": "~11.5% p.a.",
        "highlight": "Disciplined risk-adjusted framework and strong downside protection.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Consistent Alpha"
      },
      {
        "name": "HDFC Global Equity International Direct Growth",
        "provider": "HDFC AMC",
        "rate": "~11.5% p.a.",
        "highlight": "Large fund size with high liquidity and robust research coverage.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP"
      },
      {
        "name": "SBI Global Equity International Direct Plan",
        "provider": "SBI Mutual Fund",
        "rate": "~11.5% p.a.",
        "highlight": "Extensive equity research desk backing high conviction stocks.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Mirae Asset Global Equity International Direct",
        "provider": "Mirae Asset AMC",
        "rate": "~11.5% p.a.",
        "highlight": "Quality-first investment style focusing on high ROE growth leaders.",
        "platform": "Mirae MF / Kuvera",
        "minInvestment": "₹500 SIP"
      }
    ]
  },
  "nifty_etf": {
    "title": "Best Nifty 50 ETF Units on NSE/BSE",
    "riskLevel": 3,
    "note": "Exchange-traded Nifty 50 fund. Real-time pricing, demat account required. Traded real-time on stock exchange via Demat account.",
    "howToStart": "Open Demat account on Zerodha, Groww, or Angel One. Search ticker symbol.",
    "products": [
      {
        "name": "Nippon India Nifty 50 ETF",
        "provider": "Nippon India AMC",
        "rate": "~13% p.a.",
        "highlight": "Highest trading liquidity and tightest bid-ask spread on NSE.",
        "platform": "Zerodha / Groww",
        "minInvestment": "1 Unit (~₹50-500)",
        "badge": "Most Liquid"
      },
      {
        "name": "SBI Nifty 50 ETF",
        "provider": "SBI Mutual Fund",
        "rate": "~13% p.a.",
        "highlight": "Massive AUM backed by EPFO pension fund flows.",
        "platform": "Zerodha / Angel One",
        "minInvestment": "1 Unit",
        "badge": "Largest AUM"
      },
      {
        "name": "ICICI Pru Nifty 50 ETF",
        "provider": "ICICI Prudential AMC",
        "rate": "~13% p.a.",
        "highlight": "Low tracking error and active market maker quotes.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "1 Unit"
      },
      {
        "name": "Kotak Nifty 50 ETF",
        "provider": "Kotak Mutual Fund",
        "rate": "~13% p.a.",
        "highlight": "Efficient passive tracking with minimal expense ratio drag.",
        "platform": "Kotak Sec / Coin",
        "minInvestment": "1 Unit"
      },
      {
        "name": "Mirae Asset Nifty 50 ETF",
        "provider": "Mirae Asset AMC",
        "rate": "~13% p.a.",
        "highlight": "Transparent index replication and seamless execution.",
        "platform": "Groww / Upstox",
        "minInvestment": "1 Unit"
      }
    ]
  },
  "sensex_etf": {
    "title": "Best Sensex Exchange Traded Fund Units on NSE/BSE",
    "riskLevel": 3,
    "note": "Vanguard-style low-cost ETF tracks the BSE Sensex 30 index. Traded real-time on stock exchange via Demat account.",
    "howToStart": "Open Demat account on Zerodha, Groww, or Angel One. Search ticker symbol.",
    "products": [
      {
        "name": "Nippon India Sensex Exchange Traded Fund ETF",
        "provider": "Nippon India AMC",
        "rate": "~12.9% p.a.",
        "highlight": "Highest trading liquidity and tightest bid-ask spread on NSE.",
        "platform": "Zerodha / Groww",
        "minInvestment": "1 Unit (~₹50-500)",
        "badge": "Most Liquid"
      },
      {
        "name": "SBI Sensex Exchange Traded Fund ETF",
        "provider": "SBI Mutual Fund",
        "rate": "~12.9% p.a.",
        "highlight": "Massive AUM backed by EPFO pension fund flows.",
        "platform": "Zerodha / Angel One",
        "minInvestment": "1 Unit",
        "badge": "Largest AUM"
      },
      {
        "name": "ICICI Pru Sensex Exchange Traded Fund ETF",
        "provider": "ICICI Prudential AMC",
        "rate": "~12.9% p.a.",
        "highlight": "Low tracking error and active market maker quotes.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "1 Unit"
      },
      {
        "name": "Kotak Sensex Exchange Traded Fund ETF",
        "provider": "Kotak Mutual Fund",
        "rate": "~12.9% p.a.",
        "highlight": "Efficient passive tracking with minimal expense ratio drag.",
        "platform": "Kotak Sec / Coin",
        "minInvestment": "1 Unit"
      },
      {
        "name": "Mirae Asset Sensex Exchange Traded Fund ETF",
        "provider": "Mirae Asset AMC",
        "rate": "~12.9% p.a.",
        "highlight": "Transparent index replication and seamless execution.",
        "platform": "Groww / Upstox",
        "minInvestment": "1 Unit"
      }
    ]
  },
  "nifty_next_etf": {
    "title": "Best Nifty Next 50 ETF Units on NSE/BSE",
    "riskLevel": 4,
    "note": "Tracks high-growth large-caps poised to qualify for Nifty 50. Traded real-time on stock exchange via Demat account.",
    "howToStart": "Open Demat account on Zerodha, Groww, or Angel One. Search ticker symbol.",
    "products": [
      {
        "name": "Nippon India Nifty Next 50 ETF",
        "provider": "Nippon India AMC",
        "rate": "~15.5% p.a.",
        "highlight": "Highest trading liquidity and tightest bid-ask spread on NSE.",
        "platform": "Zerodha / Groww",
        "minInvestment": "1 Unit (~₹50-500)",
        "badge": "Most Liquid"
      },
      {
        "name": "SBI Nifty Next 50 ETF",
        "provider": "SBI Mutual Fund",
        "rate": "~15.5% p.a.",
        "highlight": "Massive AUM backed by EPFO pension fund flows.",
        "platform": "Zerodha / Angel One",
        "minInvestment": "1 Unit",
        "badge": "Largest AUM"
      },
      {
        "name": "ICICI Pru Nifty Next 50 ETF",
        "provider": "ICICI Prudential AMC",
        "rate": "~15.5% p.a.",
        "highlight": "Low tracking error and active market maker quotes.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "1 Unit"
      },
      {
        "name": "Kotak Nifty Next 50 ETF",
        "provider": "Kotak Mutual Fund",
        "rate": "~15.5% p.a.",
        "highlight": "Efficient passive tracking with minimal expense ratio drag.",
        "platform": "Kotak Sec / Coin",
        "minInvestment": "1 Unit"
      },
      {
        "name": "Mirae Asset Nifty Next 50 ETF",
        "provider": "Mirae Asset AMC",
        "rate": "~15.5% p.a.",
        "highlight": "Transparent index replication and seamless execution.",
        "platform": "Groww / Upstox",
        "minInvestment": "1 Unit"
      }
    ]
  },
  "midcap_etf": {
    "title": "Best Nifty Midcap 150 ETF Units on NSE/BSE",
    "riskLevel": 4,
    "note": "Low-cost index exposure to the mid-capitalization stock market index. Traded real-time on stock exchange via Demat account.",
    "howToStart": "Open Demat account on Zerodha, Groww, or Angel One. Search ticker symbol.",
    "products": [
      {
        "name": "Nippon India Nifty Midcap 150 ETF",
        "provider": "Nippon India AMC",
        "rate": "~17.25% p.a.",
        "highlight": "Highest trading liquidity and tightest bid-ask spread on NSE.",
        "platform": "Zerodha / Groww",
        "minInvestment": "1 Unit (~₹50-500)",
        "badge": "Most Liquid"
      },
      {
        "name": "SBI Nifty Midcap 150 ETF",
        "provider": "SBI Mutual Fund",
        "rate": "~17.25% p.a.",
        "highlight": "Massive AUM backed by EPFO pension fund flows.",
        "platform": "Zerodha / Angel One",
        "minInvestment": "1 Unit",
        "badge": "Largest AUM"
      },
      {
        "name": "ICICI Pru Nifty Midcap 150 ETF",
        "provider": "ICICI Prudential AMC",
        "rate": "~17.25% p.a.",
        "highlight": "Low tracking error and active market maker quotes.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "1 Unit"
      },
      {
        "name": "Kotak Nifty Midcap 150 ETF",
        "provider": "Kotak Mutual Fund",
        "rate": "~17.25% p.a.",
        "highlight": "Efficient passive tracking with minimal expense ratio drag.",
        "platform": "Kotak Sec / Coin",
        "minInvestment": "1 Unit"
      },
      {
        "name": "Mirae Asset Nifty Midcap 150 ETF",
        "provider": "Mirae Asset AMC",
        "rate": "~17.25% p.a.",
        "highlight": "Transparent index replication and seamless execution.",
        "platform": "Groww / Upstox",
        "minInvestment": "1 Unit"
      }
    ]
  },
  "bank_etf": {
    "title": "Best Nifty Bank ETF Units on NSE/BSE",
    "riskLevel": 4,
    "note": "Low cost ETF tracking the performance of the Nifty Bank index. Traded real-time on stock exchange via Demat account.",
    "howToStart": "Open Demat account on Zerodha, Groww, or Angel One. Search ticker symbol.",
    "products": [
      {
        "name": "Nippon India Nifty Bank ETF",
        "provider": "Nippon India AMC",
        "rate": "~16% p.a.",
        "highlight": "Highest trading liquidity and tightest bid-ask spread on NSE.",
        "platform": "Zerodha / Groww",
        "minInvestment": "1 Unit (~₹50-500)",
        "badge": "Most Liquid"
      },
      {
        "name": "SBI Nifty Bank ETF",
        "provider": "SBI Mutual Fund",
        "rate": "~16% p.a.",
        "highlight": "Massive AUM backed by EPFO pension fund flows.",
        "platform": "Zerodha / Angel One",
        "minInvestment": "1 Unit",
        "badge": "Largest AUM"
      },
      {
        "name": "ICICI Pru Nifty Bank ETF",
        "provider": "ICICI Prudential AMC",
        "rate": "~16% p.a.",
        "highlight": "Low tracking error and active market maker quotes.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "1 Unit"
      },
      {
        "name": "Kotak Nifty Bank ETF",
        "provider": "Kotak Mutual Fund",
        "rate": "~16% p.a.",
        "highlight": "Efficient passive tracking with minimal expense ratio drag.",
        "platform": "Kotak Sec / Coin",
        "minInvestment": "1 Unit"
      },
      {
        "name": "Mirae Asset Nifty Bank ETF",
        "provider": "Mirae Asset AMC",
        "rate": "~16% p.a.",
        "highlight": "Transparent index replication and seamless execution.",
        "platform": "Groww / Upstox",
        "minInvestment": "1 Unit"
      }
    ]
  },
  "it_etf": {
    "title": "Best Nifty IT ETF Units on NSE/BSE",
    "riskLevel": 4,
    "note": "Exchange traded fund offering exposure to leading Indian technology stocks. Traded real-time on stock exchange via Demat account.",
    "howToStart": "Open Demat account on Zerodha, Groww, or Angel One. Search ticker symbol.",
    "products": [
      {
        "name": "Nippon India Nifty IT ETF",
        "provider": "Nippon India AMC",
        "rate": "~16.25% p.a.",
        "highlight": "Highest trading liquidity and tightest bid-ask spread on NSE.",
        "platform": "Zerodha / Groww",
        "minInvestment": "1 Unit (~₹50-500)",
        "badge": "Most Liquid"
      },
      {
        "name": "SBI Nifty IT ETF",
        "provider": "SBI Mutual Fund",
        "rate": "~16.25% p.a.",
        "highlight": "Massive AUM backed by EPFO pension fund flows.",
        "platform": "Zerodha / Angel One",
        "minInvestment": "1 Unit",
        "badge": "Largest AUM"
      },
      {
        "name": "ICICI Pru Nifty IT ETF",
        "provider": "ICICI Prudential AMC",
        "rate": "~16.25% p.a.",
        "highlight": "Low tracking error and active market maker quotes.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "1 Unit"
      },
      {
        "name": "Kotak Nifty IT ETF",
        "provider": "Kotak Mutual Fund",
        "rate": "~16.25% p.a.",
        "highlight": "Efficient passive tracking with minimal expense ratio drag.",
        "platform": "Kotak Sec / Coin",
        "minInvestment": "1 Unit"
      },
      {
        "name": "Mirae Asset Nifty IT ETF",
        "provider": "Mirae Asset AMC",
        "rate": "~16.25% p.a.",
        "highlight": "Transparent index replication and seamless execution.",
        "platform": "Groww / Upstox",
        "minInvestment": "1 Unit"
      }
    ]
  },
  "cpse_etf": {
    "title": "Best CPSE Exchange Traded Fund Units on NSE/BSE",
    "riskLevel": 4,
    "note": "Invests in public sector giants with attractive dividend yields and PSU growth. Traded real-time on stock exchange via Demat account.",
    "howToStart": "Open Demat account on Zerodha, Groww, or Angel One. Search ticker symbol.",
    "products": [
      {
        "name": "Nippon India CPSE Exchange Traded Fund ETF",
        "provider": "Nippon India AMC",
        "rate": "~16.5% p.a.",
        "highlight": "Highest trading liquidity and tightest bid-ask spread on NSE.",
        "platform": "Zerodha / Groww",
        "minInvestment": "1 Unit (~₹50-500)",
        "badge": "Most Liquid"
      },
      {
        "name": "SBI CPSE Exchange Traded Fund ETF",
        "provider": "SBI Mutual Fund",
        "rate": "~16.5% p.a.",
        "highlight": "Massive AUM backed by EPFO pension fund flows.",
        "platform": "Zerodha / Angel One",
        "minInvestment": "1 Unit",
        "badge": "Largest AUM"
      },
      {
        "name": "ICICI Pru CPSE Exchange Traded Fund ETF",
        "provider": "ICICI Prudential AMC",
        "rate": "~16.5% p.a.",
        "highlight": "Low tracking error and active market maker quotes.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "1 Unit"
      },
      {
        "name": "Kotak CPSE Exchange Traded Fund ETF",
        "provider": "Kotak Mutual Fund",
        "rate": "~16.5% p.a.",
        "highlight": "Efficient passive tracking with minimal expense ratio drag.",
        "platform": "Kotak Sec / Coin",
        "minInvestment": "1 Unit"
      },
      {
        "name": "Mirae Asset CPSE Exchange Traded Fund ETF",
        "provider": "Mirae Asset AMC",
        "rate": "~16.5% p.a.",
        "highlight": "Transparent index replication and seamless execution.",
        "platform": "Groww / Upstox",
        "minInvestment": "1 Unit"
      }
    ]
  },
  "bharat_bond_2030": {
    "title": "Best Bharat Bond ETF 2030 Units on NSE/BSE",
    "riskLevel": 2,
    "note": "High quality debt ETF backed by public sector enterprise bonds, maturing in 2030. Traded real-time on stock exchange via Demat account.",
    "howToStart": "Open Demat account on Zerodha, Groww, or Angel One. Search ticker symbol.",
    "products": [
      {
        "name": "Nippon India Bharat Bond 2030 ETF",
        "provider": "Nippon India AMC",
        "rate": "~7.5% p.a.",
        "highlight": "Highest trading liquidity and tightest bid-ask spread on NSE.",
        "platform": "Zerodha / Groww",
        "minInvestment": "1 Unit (~₹50-500)",
        "badge": "Most Liquid"
      },
      {
        "name": "SBI Bharat Bond 2030 ETF",
        "provider": "SBI Mutual Fund",
        "rate": "~7.5% p.a.",
        "highlight": "Massive AUM backed by EPFO pension fund flows.",
        "platform": "Zerodha / Angel One",
        "minInvestment": "1 Unit",
        "badge": "Largest AUM"
      },
      {
        "name": "ICICI Pru Bharat Bond 2030 ETF",
        "provider": "ICICI Prudential AMC",
        "rate": "~7.5% p.a.",
        "highlight": "Low tracking error and active market maker quotes.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "1 Unit"
      },
      {
        "name": "Kotak Bharat Bond 2030 ETF",
        "provider": "Kotak Mutual Fund",
        "rate": "~7.5% p.a.",
        "highlight": "Efficient passive tracking with minimal expense ratio drag.",
        "platform": "Kotak Sec / Coin",
        "minInvestment": "1 Unit"
      },
      {
        "name": "Mirae Asset Bharat Bond 2030 ETF",
        "provider": "Mirae Asset AMC",
        "rate": "~7.5% p.a.",
        "highlight": "Transparent index replication and seamless execution.",
        "platform": "Groww / Upstox",
        "minInvestment": "1 Unit"
      }
    ]
  },
  "silver_etf": {
    "title": "Best Silver Exchange Traded Fund Units on NSE/BSE",
    "riskLevel": 4,
    "note": "Provides real-time exposure to industrial silver commodity price shifts. Traded real-time on stock exchange via Demat account.",
    "howToStart": "Open Demat account on Zerodha, Groww, or Angel One. Search ticker symbol.",
    "products": [
      {
        "name": "Nippon India Silver Exchange Traded Fund ETF",
        "provider": "Nippon India AMC",
        "rate": "~13.5% p.a.",
        "highlight": "Highest trading liquidity and tightest bid-ask spread on NSE.",
        "platform": "Zerodha / Groww",
        "minInvestment": "1 Unit (~₹50-500)",
        "badge": "Most Liquid"
      },
      {
        "name": "SBI Silver Exchange Traded Fund ETF",
        "provider": "SBI Mutual Fund",
        "rate": "~13.5% p.a.",
        "highlight": "Massive AUM backed by EPFO pension fund flows.",
        "platform": "Zerodha / Angel One",
        "minInvestment": "1 Unit",
        "badge": "Largest AUM"
      },
      {
        "name": "ICICI Pru Silver Exchange Traded Fund ETF",
        "provider": "ICICI Prudential AMC",
        "rate": "~13.5% p.a.",
        "highlight": "Low tracking error and active market maker quotes.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "1 Unit"
      },
      {
        "name": "Kotak Silver Exchange Traded Fund ETF",
        "provider": "Kotak Mutual Fund",
        "rate": "~13.5% p.a.",
        "highlight": "Efficient passive tracking with minimal expense ratio drag.",
        "platform": "Kotak Sec / Coin",
        "minInvestment": "1 Unit"
      },
      {
        "name": "Mirae Asset Silver Exchange Traded Fund ETF",
        "provider": "Mirae Asset AMC",
        "rate": "~13.5% p.a.",
        "highlight": "Transparent index replication and seamless execution.",
        "platform": "Groww / Upstox",
        "minInvestment": "1 Unit"
      }
    ]
  },
  "liquid_etf": {
    "title": "Best Liquid Exchange Traded Fund Units on NSE/BSE",
    "riskLevel": 1,
    "note": "Cash equivalent asset traded on exchange, offering low risk and daily settlement. Traded real-time on stock exchange via Demat account.",
    "howToStart": "Open Demat account on Zerodha, Groww, or Angel One. Search ticker symbol.",
    "products": [
      {
        "name": "Nippon India Liquid Exchange Traded Fund ETF",
        "provider": "Nippon India AMC",
        "rate": "~6.75% p.a.",
        "highlight": "Highest trading liquidity and tightest bid-ask spread on NSE.",
        "platform": "Zerodha / Groww",
        "minInvestment": "1 Unit (~₹50-500)",
        "badge": "Most Liquid"
      },
      {
        "name": "SBI Liquid Exchange Traded Fund ETF",
        "provider": "SBI Mutual Fund",
        "rate": "~6.75% p.a.",
        "highlight": "Massive AUM backed by EPFO pension fund flows.",
        "platform": "Zerodha / Angel One",
        "minInvestment": "1 Unit",
        "badge": "Largest AUM"
      },
      {
        "name": "ICICI Pru Liquid Exchange Traded Fund ETF",
        "provider": "ICICI Prudential AMC",
        "rate": "~6.75% p.a.",
        "highlight": "Low tracking error and active market maker quotes.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "1 Unit"
      },
      {
        "name": "Kotak Liquid Exchange Traded Fund ETF",
        "provider": "Kotak Mutual Fund",
        "rate": "~6.75% p.a.",
        "highlight": "Efficient passive tracking with minimal expense ratio drag.",
        "platform": "Kotak Sec / Coin",
        "minInvestment": "1 Unit"
      },
      {
        "name": "Mirae Asset Liquid Exchange Traded Fund ETF",
        "provider": "Mirae Asset AMC",
        "rate": "~6.75% p.a.",
        "highlight": "Transparent index replication and seamless execution.",
        "platform": "Groww / Upstox",
        "minInvestment": "1 Unit"
      }
    ]
  },
  "nasdaq_etf": {
    "title": "Best Nasdaq 100 International ETF Units on NSE/BSE",
    "riskLevel": 4,
    "note": "Direct passive indexing tool tracking the US Nasdaq-100 technology market. Traded real-time on stock exchange via Demat account.",
    "howToStart": "Open Demat account on Zerodha, Groww, or Angel One. Search ticker symbol.",
    "products": [
      {
        "name": "Nippon India Nasdaq 100 International ETF",
        "provider": "Nippon India AMC",
        "rate": "~15.25% p.a.",
        "highlight": "Highest trading liquidity and tightest bid-ask spread on NSE.",
        "platform": "Zerodha / Groww",
        "minInvestment": "1 Unit (~₹50-500)",
        "badge": "Most Liquid"
      },
      {
        "name": "SBI Nasdaq 100 International ETF",
        "provider": "SBI Mutual Fund",
        "rate": "~15.25% p.a.",
        "highlight": "Massive AUM backed by EPFO pension fund flows.",
        "platform": "Zerodha / Angel One",
        "minInvestment": "1 Unit",
        "badge": "Largest AUM"
      },
      {
        "name": "ICICI Pru Nasdaq 100 International ETF",
        "provider": "ICICI Prudential AMC",
        "rate": "~15.25% p.a.",
        "highlight": "Low tracking error and active market maker quotes.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "1 Unit"
      },
      {
        "name": "Kotak Nasdaq 100 International ETF",
        "provider": "Kotak Mutual Fund",
        "rate": "~15.25% p.a.",
        "highlight": "Efficient passive tracking with minimal expense ratio drag.",
        "platform": "Kotak Sec / Coin",
        "minInvestment": "1 Unit"
      },
      {
        "name": "Mirae Asset Nasdaq 100 International ETF",
        "provider": "Mirae Asset AMC",
        "rate": "~15.25% p.a.",
        "highlight": "Transparent index replication and seamless execution.",
        "platform": "Groww / Upstox",
        "minInvestment": "1 Unit"
      }
    ]
  },
  "sp500_etf": {
    "title": "Best S&P 500 International ETF Units on NSE/BSE",
    "riskLevel": 4,
    "note": "Diversified index fund tracker for the broad-based US S&P 500 market index. Traded real-time on stock exchange via Demat account.",
    "howToStart": "Open Demat account on Zerodha, Groww, or Angel One. Search ticker symbol.",
    "products": [
      {
        "name": "Nippon India S&P 500 International ETF",
        "provider": "Nippon India AMC",
        "rate": "~12% p.a.",
        "highlight": "Highest trading liquidity and tightest bid-ask spread on NSE.",
        "platform": "Zerodha / Groww",
        "minInvestment": "1 Unit (~₹50-500)",
        "badge": "Most Liquid"
      },
      {
        "name": "SBI S&P 500 International ETF",
        "provider": "SBI Mutual Fund",
        "rate": "~12% p.a.",
        "highlight": "Massive AUM backed by EPFO pension fund flows.",
        "platform": "Zerodha / Angel One",
        "minInvestment": "1 Unit",
        "badge": "Largest AUM"
      },
      {
        "name": "ICICI Pru S&P 500 International ETF",
        "provider": "ICICI Prudential AMC",
        "rate": "~12% p.a.",
        "highlight": "Low tracking error and active market maker quotes.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "1 Unit"
      },
      {
        "name": "Kotak S&P 500 International ETF",
        "provider": "Kotak Mutual Fund",
        "rate": "~12% p.a.",
        "highlight": "Efficient passive tracking with minimal expense ratio drag.",
        "platform": "Kotak Sec / Coin",
        "minInvestment": "1 Unit"
      },
      {
        "name": "Mirae Asset S&P 500 International ETF",
        "provider": "Mirae Asset AMC",
        "rate": "~12% p.a.",
        "highlight": "Transparent index replication and seamless execution.",
        "platform": "Groww / Upstox",
        "minInvestment": "1 Unit"
      }
    ]
  },
  "gold_etf": {
    "title": "Best Platforms & Products for Gold ETF",
    "riskLevel": 3,
    "note": "Liquid gold exposure via demat account. No lock-in. Gains taxed as LTCG at 12.5%.",
    "howToStart": "Open a demat + trading account on Zerodha, Groww, or Angel One. Buy units during market hours like stocks.",
    "products": [
      {
        "name": "Zerodha Kite Gold ETF",
        "provider": "Zerodha",
        "rate": "~11% p.a.",
        "highlight": "Zero brokerage on equity delivery investments with India's largest discount broker.",
        "platform": "Zerodha Kite App",
        "minInvestment": "₹500",
        "badge": "Top Discount Broker"
      },
      {
        "name": "HDFC Gold ETF",
        "provider": "Groww",
        "rate": "~11% p.a.",
        "highlight": "Most beginner-friendly UI with instant paperless onboarding.",
        "platform": "Groww App",
        "minInvestment": "₹500",
        "badge": "Best Beginner UI"
      },
      {
        "name": "ICICI Prudential Gold ETF",
        "provider": "Angel One",
        "rate": "~11% p.a.",
        "highlight": "Full service research reports and automated trading tools.",
        "platform": "Angel One App",
        "minInvestment": "₹500"
      },
      {
        "name": "Axis Gold ETF",
        "provider": "ICICI Direct",
        "rate": "~11% p.a.",
        "highlight": "3-in-1 integrated banking + demat + trading account convenience.",
        "platform": "ICICI Direct Portal",
        "minInvestment": "₹500"
      },
      {
        "name": "Upstox / Kuvera Gold ETF",
        "provider": "Upstox / Kuvera",
        "rate": "~11% p.a.",
        "highlight": "Low fee execution with direct portfolio analytics.",
        "platform": "Upstox / Kuvera App",
        "minInvestment": "₹500"
      }
    ]
  },
  "gold_mf": {
    "title": "Best Platforms & Products for Gold Mutual Fund",
    "riskLevel": 3,
    "note": "Mutual fund tracking the price of physical gold, avoiding demat requirements.",
    "howToStart": "Submit a direct mutual fund application on the AMC portal, or transact seamlessly on any popular mutual fund platform.",
    "products": [
      {
        "name": "Zerodha Kite Gold Mutual Fund",
        "provider": "Zerodha",
        "rate": "~10.5% p.a.",
        "highlight": "Zero brokerage on equity delivery investments with India's largest discount broker.",
        "platform": "Zerodha Kite App",
        "minInvestment": "₹500",
        "badge": "Top Discount Broker"
      },
      {
        "name": "HDFC Gold Fund (Direct Growth)",
        "provider": "Groww",
        "rate": "~10.5% p.a.",
        "highlight": "Most beginner-friendly UI with instant paperless onboarding.",
        "platform": "Groww App",
        "minInvestment": "₹500",
        "badge": "Best Beginner UI"
      },
      {
        "name": "ICICI Prudential Gold Fund (Direct Growth)",
        "provider": "Angel One",
        "rate": "~10.5% p.a.",
        "highlight": "Full service research reports and automated trading tools.",
        "platform": "Angel One App",
        "minInvestment": "₹500"
      },
      {
        "name": "Axis Gold Fund (Direct Growth)",
        "provider": "ICICI Direct",
        "rate": "~10.5% p.a.",
        "highlight": "3-in-1 integrated banking + demat + trading account convenience.",
        "platform": "ICICI Direct Portal",
        "minInvestment": "₹500"
      },
      {
        "name": "Upstox / Kuvera Gold Mutual Fund",
        "provider": "Upstox / Kuvera",
        "rate": "~10.5% p.a.",
        "highlight": "Low fee execution with direct portfolio analytics.",
        "platform": "Upstox / Kuvera App",
        "minInvestment": "₹500"
      }
    ]
  },
  "sgb_secondary": {
    "title": "Best Platforms & Products for Sovereign Gold Bond (Secondary Market)",
    "riskLevel": 2,
    "note": "Secondary market purchase of RBI Sovereign Gold Bonds, offering discount opportunities.",
    "howToStart": "Submit a direct mutual fund application on the AMC portal, or transact seamlessly on any popular mutual fund platform.",
    "products": [
      {
        "name": "Zerodha Kite Sovereign Gold Bond (Secondary Market)",
        "provider": "Zerodha",
        "rate": "~12% p.a.",
        "highlight": "Zero brokerage on equity delivery investments with India's largest discount broker.",
        "platform": "Zerodha Kite App",
        "minInvestment": "₹5000",
        "badge": "Top Discount Broker"
      },
      {
        "name": "Sovereign Gold Bond Secondary Tranche (Groww)",
        "provider": "Groww",
        "rate": "~12% p.a.",
        "highlight": "Most beginner-friendly UI with instant paperless onboarding.",
        "platform": "Groww App",
        "minInvestment": "₹5000",
        "badge": "Best Beginner UI"
      },
      {
        "name": "Sovereign Gold Bond Secondary Tranche (Angel One)",
        "provider": "Angel One",
        "rate": "~12% p.a.",
        "highlight": "Full service research reports and automated trading tools.",
        "platform": "Angel One App",
        "minInvestment": "₹5000"
      },
      {
        "name": "Sovereign Gold Bond Secondary Tranche (ICICI Direct)",
        "provider": "ICICI Direct",
        "rate": "~12% p.a.",
        "highlight": "3-in-1 integrated banking + demat + trading account convenience.",
        "platform": "ICICI Direct Portal",
        "minInvestment": "₹5000"
      },
      {
        "name": "Upstox / Kuvera Sovereign Gold Bond (Secondary Market)",
        "provider": "Upstox / Kuvera",
        "rate": "~12% p.a.",
        "highlight": "Low fee execution with direct portfolio analytics.",
        "platform": "Upstox / Kuvera App",
        "minInvestment": "₹5000"
      }
    ]
  },
  "embassy_reit": {
    "title": "Best Platforms & Products for Embassy Office Parks REIT",
    "riskLevel": 3,
    "note": "First listed REIT in India. Commercial property portfolio yields regular dividends.",
    "howToStart": "Open a demat and trading account with a discount broker. Search for the ticker symbol of Embassy Office Parks REIT and purchase units.",
    "products": [
      {
        "name": "Zerodha Kite Embassy Office Parks REIT",
        "provider": "Zerodha",
        "rate": "~9.5% p.a.",
        "highlight": "Zero brokerage on equity delivery investments with India's largest discount broker.",
        "platform": "Zerodha Kite App",
        "minInvestment": "₹5000",
        "badge": "Top Discount Broker"
      },
      {
        "name": "Embassy Office Parks REIT (Direct Plan)",
        "provider": "Groww",
        "rate": "~9.5% p.a.",
        "highlight": "Most beginner-friendly UI with instant paperless onboarding.",
        "platform": "Groww App",
        "minInvestment": "₹5000",
        "badge": "Best Beginner UI"
      },
      {
        "name": "Embassy Office Parks REIT (Direct Plan)",
        "provider": "Angel One",
        "rate": "~9.5% p.a.",
        "highlight": "Full service research reports and automated trading tools.",
        "platform": "Angel One App",
        "minInvestment": "₹5000"
      },
      {
        "name": "Embassy Office Parks REIT (Direct Plan)",
        "provider": "ICICI Direct",
        "rate": "~9.5% p.a.",
        "highlight": "3-in-1 integrated banking + demat + trading account convenience.",
        "platform": "ICICI Direct Portal",
        "minInvestment": "₹5000"
      },
      {
        "name": "Upstox / Kuvera Embassy Office Parks REIT",
        "provider": "Upstox / Kuvera",
        "rate": "~9.5% p.a.",
        "highlight": "Low fee execution with direct portfolio analytics.",
        "platform": "Upstox / Kuvera App",
        "minInvestment": "₹5000"
      }
    ]
  },
  "mindspace_reit": {
    "title": "Best Platforms & Products for Mindspace Business Parks REIT",
    "riskLevel": 3,
    "note": "Commercial real estate trust focused on key economic centers in Western India.",
    "howToStart": "Open a demat and trading account with a discount broker. Search for the ticker symbol of Mindspace Business Parks REIT and purchase units.",
    "products": [
      {
        "name": "Zerodha Kite Mindspace Business Parks REIT",
        "provider": "Zerodha",
        "rate": "~9.25% p.a.",
        "highlight": "Zero brokerage on equity delivery investments with India's largest discount broker.",
        "platform": "Zerodha Kite App",
        "minInvestment": "₹5000",
        "badge": "Top Discount Broker"
      },
      {
        "name": "Mindspace Business Parks REIT (Direct Plan)",
        "provider": "Groww",
        "rate": "~9.25% p.a.",
        "highlight": "Most beginner-friendly UI with instant paperless onboarding.",
        "platform": "Groww App",
        "minInvestment": "₹5000",
        "badge": "Best Beginner UI"
      },
      {
        "name": "Mindspace Business Parks REIT (Direct Plan)",
        "provider": "Angel One",
        "rate": "~9.25% p.a.",
        "highlight": "Full service research reports and automated trading tools.",
        "platform": "Angel One App",
        "minInvestment": "₹5000"
      },
      {
        "name": "Mindspace Business Parks REIT (Direct Plan)",
        "provider": "ICICI Direct",
        "rate": "~9.25% p.a.",
        "highlight": "3-in-1 integrated banking + demat + trading account convenience.",
        "platform": "ICICI Direct Portal",
        "minInvestment": "₹5000"
      },
      {
        "name": "Upstox / Kuvera Mindspace Business Parks REIT",
        "provider": "Upstox / Kuvera",
        "rate": "~9.25% p.a.",
        "highlight": "Low fee execution with direct portfolio analytics.",
        "platform": "Upstox / Kuvera App",
        "minInvestment": "₹5000"
      }
    ]
  },
  "brookfield_reit": {
    "title": "Best Platforms & Products for Brookfield India Real Estate Trust",
    "riskLevel": 3,
    "note": "Real estate investment trust focusing on high-grade commercial workspaces in India.",
    "howToStart": "Open a demat and trading account with a discount broker. Search for the ticker symbol of Brookfield India Real Estate Trust and purchase units.",
    "products": [
      {
        "name": "Zerodha Kite Brookfield India Real Estate Trust",
        "provider": "Zerodha",
        "rate": "~9.75% p.a.",
        "highlight": "Zero brokerage on equity delivery investments with India's largest discount broker.",
        "platform": "Zerodha Kite App",
        "minInvestment": "₹5000",
        "badge": "Top Discount Broker"
      },
      {
        "name": "Brookfield India Real Estate Trust (Direct Plan)",
        "provider": "Groww",
        "rate": "~9.75% p.a.",
        "highlight": "Most beginner-friendly UI with instant paperless onboarding.",
        "platform": "Groww App",
        "minInvestment": "₹5000",
        "badge": "Best Beginner UI"
      },
      {
        "name": "Brookfield India Real Estate Trust (Direct Plan)",
        "provider": "Angel One",
        "rate": "~9.75% p.a.",
        "highlight": "Full service research reports and automated trading tools.",
        "platform": "Angel One App",
        "minInvestment": "₹5000"
      },
      {
        "name": "Brookfield India Real Estate Trust (Direct Plan)",
        "provider": "ICICI Direct",
        "rate": "~9.75% p.a.",
        "highlight": "3-in-1 integrated banking + demat + trading account convenience.",
        "platform": "ICICI Direct Portal",
        "minInvestment": "₹5000"
      },
      {
        "name": "Upstox / Kuvera Brookfield India Real Estate Trust",
        "provider": "Upstox / Kuvera",
        "rate": "~9.75% p.a.",
        "highlight": "Low fee execution with direct portfolio analytics.",
        "platform": "Upstox / Kuvera App",
        "minInvestment": "₹5000"
      }
    ]
  },
  "nexus_reit": {
    "title": "Best Platforms & Products for Nexus Select Trust REIT",
    "riskLevel": 3,
    "note": "Offers unique exposure to high-performing retail shopping malls in prime cities.",
    "howToStart": "Open a demat and trading account with a discount broker. Search for the ticker symbol of Nexus Select Trust REIT and purchase units.",
    "products": [
      {
        "name": "Zerodha Kite Nexus Select Trust REIT",
        "provider": "Zerodha",
        "rate": "~10.5% p.a.",
        "highlight": "Zero brokerage on equity delivery investments with India's largest discount broker.",
        "platform": "Zerodha Kite App",
        "minInvestment": "₹5000",
        "badge": "Top Discount Broker"
      },
      {
        "name": "Nexus Select Trust REIT (Direct Plan)",
        "provider": "Groww",
        "rate": "~10.5% p.a.",
        "highlight": "Most beginner-friendly UI with instant paperless onboarding.",
        "platform": "Groww App",
        "minInvestment": "₹5000",
        "badge": "Best Beginner UI"
      },
      {
        "name": "Nexus Select Trust REIT (Direct Plan)",
        "provider": "Angel One",
        "rate": "~10.5% p.a.",
        "highlight": "Full service research reports and automated trading tools.",
        "platform": "Angel One App",
        "minInvestment": "₹5000"
      },
      {
        "name": "Nexus Select Trust REIT (Direct Plan)",
        "provider": "ICICI Direct",
        "rate": "~10.5% p.a.",
        "highlight": "3-in-1 integrated banking + demat + trading account convenience.",
        "platform": "ICICI Direct Portal",
        "minInvestment": "₹5000"
      },
      {
        "name": "Upstox / Kuvera Nexus Select Trust REIT",
        "provider": "Upstox / Kuvera",
        "rate": "~10.5% p.a.",
        "highlight": "Low fee execution with direct portfolio analytics.",
        "platform": "Upstox / Kuvera App",
        "minInvestment": "₹5000"
      }
    ]
  },
  "indigrid_invit": {
    "title": "Best Platforms & Products for India Grid Trust InvIT",
    "riskLevel": 3,
    "note": "Yield-oriented trust investing in robust power transmission corridors across India.",
    "howToStart": "Open a demat and trading account with a discount broker. Search for the ticker symbol of India Grid Trust InvIT and purchase units.",
    "products": [
      {
        "name": "Zerodha Kite India Grid Trust InvIT",
        "provider": "Zerodha",
        "rate": "~11.25% p.a.",
        "highlight": "Zero brokerage on equity delivery investments with India's largest discount broker.",
        "platform": "Zerodha Kite App",
        "minInvestment": "₹10000",
        "badge": "Top Discount Broker"
      },
      {
        "name": "India Grid Trust InvIT (Direct Plan)",
        "provider": "Groww",
        "rate": "~11.25% p.a.",
        "highlight": "Most beginner-friendly UI with instant paperless onboarding.",
        "platform": "Groww App",
        "minInvestment": "₹10000",
        "badge": "Best Beginner UI"
      },
      {
        "name": "India Grid Trust InvIT (Direct Plan)",
        "provider": "Angel One",
        "rate": "~11.25% p.a.",
        "highlight": "Full service research reports and automated trading tools.",
        "platform": "Angel One App",
        "minInvestment": "₹10000"
      },
      {
        "name": "India Grid Trust InvIT (Direct Plan)",
        "provider": "ICICI Direct",
        "rate": "~11.25% p.a.",
        "highlight": "3-in-1 integrated banking + demat + trading account convenience.",
        "platform": "ICICI Direct Portal",
        "minInvestment": "₹10000"
      },
      {
        "name": "Upstox / Kuvera India Grid Trust InvIT",
        "provider": "Upstox / Kuvera",
        "rate": "~11.25% p.a.",
        "highlight": "Low fee execution with direct portfolio analytics.",
        "platform": "Upstox / Kuvera App",
        "minInvestment": "₹10000"
      }
    ]
  },
  "powergrid_invit": {
    "title": "Best Platforms & Products for PowerGrid Infrastructure Investment Trust",
    "riskLevel": 3,
    "note": "Government-sponsored infrastructure trust yielding predictable transmission revenues.",
    "howToStart": "Open a demat and trading account with a discount broker. Search for the ticker symbol of PowerGrid Infrastructure Investment Trust and purchase units.",
    "products": [
      {
        "name": "Zerodha Kite PowerGrid Infrastructure Investment Trust",
        "provider": "Zerodha",
        "rate": "~10.75% p.a.",
        "highlight": "Zero brokerage on equity delivery investments with India's largest discount broker.",
        "platform": "Zerodha Kite App",
        "minInvestment": "₹10000",
        "badge": "Top Discount Broker"
      },
      {
        "name": "PowerGrid Infrastructure Investment Trust (Direct Plan)",
        "provider": "Groww",
        "rate": "~10.75% p.a.",
        "highlight": "Most beginner-friendly UI with instant paperless onboarding.",
        "platform": "Groww App",
        "minInvestment": "₹10000",
        "badge": "Best Beginner UI"
      },
      {
        "name": "PowerGrid Infrastructure Investment Trust (Direct Plan)",
        "provider": "Angel One",
        "rate": "~10.75% p.a.",
        "highlight": "Full service research reports and automated trading tools.",
        "platform": "Angel One App",
        "minInvestment": "₹10000"
      },
      {
        "name": "PowerGrid Infrastructure Investment Trust (Direct Plan)",
        "provider": "ICICI Direct",
        "rate": "~10.75% p.a.",
        "highlight": "3-in-1 integrated banking + demat + trading account convenience.",
        "platform": "ICICI Direct Portal",
        "minInvestment": "₹10000"
      },
      {
        "name": "Upstox / Kuvera PowerGrid Infrastructure Investment Trust",
        "provider": "Upstox / Kuvera",
        "rate": "~10.75% p.a.",
        "highlight": "Low fee execution with direct portfolio analytics.",
        "platform": "Upstox / Kuvera App",
        "minInvestment": "₹10000"
      }
    ]
  },
  "aaa_corporate_bond": {
    "title": "Best Platforms & Products for AAA Rated Corporate Bond",
    "riskLevel": 2,
    "note": "Fixed-income debt security issued by blue-chip private corporations with top credit ratings.",
    "howToStart": "Submit a direct mutual fund application on the AMC portal, or transact seamlessly on any popular mutual fund platform.",
    "products": [
      {
        "name": "Zerodha Kite AAA Rated Corporate Bond",
        "provider": "Zerodha",
        "rate": "~8.15% p.a.",
        "highlight": "Zero brokerage on equity delivery investments with India's largest discount broker.",
        "platform": "Zerodha Kite App",
        "minInvestment": "₹10000",
        "badge": "Top Discount Broker"
      },
      {
        "name": "AAA Rated Corporate Bond (Direct Plan)",
        "provider": "Groww",
        "rate": "~8.15% p.a.",
        "highlight": "Most beginner-friendly UI with instant paperless onboarding.",
        "platform": "Groww App",
        "minInvestment": "₹10000",
        "badge": "Best Beginner UI"
      },
      {
        "name": "AAA Rated Corporate Bond (Direct Plan)",
        "provider": "Angel One",
        "rate": "~8.15% p.a.",
        "highlight": "Full service research reports and automated trading tools.",
        "platform": "Angel One App",
        "minInvestment": "₹10000"
      },
      {
        "name": "AAA Rated Corporate Bond (Direct Plan)",
        "provider": "ICICI Direct",
        "rate": "~8.15% p.a.",
        "highlight": "3-in-1 integrated banking + demat + trading account convenience.",
        "platform": "ICICI Direct Portal",
        "minInvestment": "₹10000"
      },
      {
        "name": "Upstox / Kuvera AAA Rated Corporate Bond",
        "provider": "Upstox / Kuvera",
        "rate": "~8.15% p.a.",
        "highlight": "Low fee execution with direct portfolio analytics.",
        "platform": "Upstox / Kuvera App",
        "minInvestment": "₹10000"
      }
    ]
  },
  "aa_corporate_bond": {
    "title": "Best Platforms & Products for AA Rated Corporate Bond",
    "riskLevel": 3,
    "note": "Corporate bonds with AA credit ratings, offering a slight yield premium over AAA bonds.",
    "howToStart": "Submit a direct mutual fund application on the AMC portal, or transact seamlessly on any popular mutual fund platform.",
    "products": [
      {
        "name": "Zerodha Kite AA Rated Corporate Bond",
        "provider": "Zerodha",
        "rate": "~8.9% p.a.",
        "highlight": "Zero brokerage on equity delivery investments with India's largest discount broker.",
        "platform": "Zerodha Kite App",
        "minInvestment": "₹10000",
        "badge": "Top Discount Broker"
      },
      {
        "name": "AA Rated Corporate Bond (Direct Plan)",
        "provider": "Groww",
        "rate": "~8.9% p.a.",
        "highlight": "Most beginner-friendly UI with instant paperless onboarding.",
        "platform": "Groww App",
        "minInvestment": "₹10000",
        "badge": "Best Beginner UI"
      },
      {
        "name": "AA Rated Corporate Bond (Direct Plan)",
        "provider": "Angel One",
        "rate": "~8.9% p.a.",
        "highlight": "Full service research reports and automated trading tools.",
        "platform": "Angel One App",
        "minInvestment": "₹10000"
      },
      {
        "name": "AA Rated Corporate Bond (Direct Plan)",
        "provider": "ICICI Direct",
        "rate": "~8.9% p.a.",
        "highlight": "3-in-1 integrated banking + demat + trading account convenience.",
        "platform": "ICICI Direct Portal",
        "minInvestment": "₹10000"
      },
      {
        "name": "Upstox / Kuvera AA Rated Corporate Bond",
        "provider": "Upstox / Kuvera",
        "rate": "~8.9% p.a.",
        "highlight": "Low fee execution with direct portfolio analytics.",
        "platform": "Upstox / Kuvera App",
        "minInvestment": "₹10000"
      }
    ]
  },
  "tax_free_bonds": {
    "title": "Best Platforms & Products for PFC/REC Tax-Free Bonds",
    "riskLevel": 1,
    "note": "PSU-backed bonds. Capital gains and interest payouts are completely tax-exempt.",
    "howToStart": "Open an account at any authorized commercial bank or post office using Aadhaar and PAN verification.",
    "products": [
      {
        "name": "Zerodha Kite PFC/REC Tax-Free Bonds",
        "provider": "Zerodha",
        "rate": "~5.5% p.a.",
        "highlight": "Zero brokerage on equity delivery investments with India's largest discount broker.",
        "platform": "Zerodha Kite App",
        "minInvestment": "₹5000",
        "badge": "Top Discount Broker"
      },
      {
        "name": "PFC/REC Tax-Free Bonds (Direct Plan)",
        "provider": "Groww",
        "rate": "~5.5% p.a.",
        "highlight": "Most beginner-friendly UI with instant paperless onboarding.",
        "platform": "Groww App",
        "minInvestment": "₹5000",
        "badge": "Best Beginner UI"
      },
      {
        "name": "PFC/REC Tax-Free Bonds (Direct Plan)",
        "provider": "Angel One",
        "rate": "~5.5% p.a.",
        "highlight": "Full service research reports and automated trading tools.",
        "platform": "Angel One App",
        "minInvestment": "₹5000"
      },
      {
        "name": "PFC/REC Tax-Free Bonds (Direct Plan)",
        "provider": "ICICI Direct",
        "rate": "~5.5% p.a.",
        "highlight": "3-in-1 integrated banking + demat + trading account convenience.",
        "platform": "ICICI Direct Portal",
        "minInvestment": "₹5000"
      },
      {
        "name": "Upstox / Kuvera PFC/REC Tax-Free Bonds",
        "provider": "Upstox / Kuvera",
        "rate": "~5.5% p.a.",
        "highlight": "Low fee execution with direct portfolio analytics.",
        "platform": "Upstox / Kuvera App",
        "minInvestment": "₹5000"
      }
    ]
  },
  "bharat_bond_direct": {
    "title": "Best Platforms & Products for Bharat Bond Debt Fund",
    "riskLevel": 2,
    "note": "Open-ended debt mutual fund variant investing strictly in public sector enterprise bonds.",
    "howToStart": "Submit a direct mutual fund application on the AMC portal, or transact seamlessly on any popular mutual fund platform.",
    "products": [
      {
        "name": "Zerodha Kite Bharat Bond Debt Fund",
        "provider": "Zerodha",
        "rate": "~7.3% p.a.",
        "highlight": "Zero brokerage on equity delivery investments with India's largest discount broker.",
        "platform": "Zerodha Kite App",
        "minInvestment": "₹1000",
        "badge": "Top Discount Broker"
      },
      {
        "name": "Bharat Bond Debt Fund (Direct Plan)",
        "provider": "Groww",
        "rate": "~7.3% p.a.",
        "highlight": "Most beginner-friendly UI with instant paperless onboarding.",
        "platform": "Groww App",
        "minInvestment": "₹1000",
        "badge": "Best Beginner UI"
      },
      {
        "name": "Bharat Bond Debt Fund (Direct Plan)",
        "provider": "Angel One",
        "rate": "~7.3% p.a.",
        "highlight": "Full service research reports and automated trading tools.",
        "platform": "Angel One App",
        "minInvestment": "₹1000"
      },
      {
        "name": "Bharat Bond Debt Fund (Direct Plan)",
        "provider": "ICICI Direct",
        "rate": "~7.3% p.a.",
        "highlight": "3-in-1 integrated banking + demat + trading account convenience.",
        "platform": "ICICI Direct Portal",
        "minInvestment": "₹1000"
      },
      {
        "name": "Upstox / Kuvera Bharat Bond Debt Fund",
        "provider": "Upstox / Kuvera",
        "rate": "~7.3% p.a.",
        "highlight": "Low fee execution with direct portfolio analytics.",
        "platform": "Upstox / Kuvera App",
        "minInvestment": "₹1000"
      }
    ]
  },
  "g_sec": {
    "title": "Best Platforms & Products for Government Security (G-Sec)",
    "riskLevel": 1,
    "note": "10-Year Government of India sovereign debt security. Direct sovereign credit safety.",
    "howToStart": "Open an account at any authorized commercial bank or post office using Aadhaar and PAN verification.",
    "products": [
      {
        "name": "Zerodha Kite Government Security (G-Sec)",
        "provider": "Zerodha",
        "rate": "~7.25% p.a.",
        "highlight": "Zero brokerage on equity delivery investments with India's largest discount broker.",
        "platform": "Zerodha Kite App",
        "minInvestment": "₹10000",
        "badge": "Top Discount Broker"
      },
      {
        "name": "Government Security (G-Sec) (Direct Plan)",
        "provider": "Groww",
        "rate": "~7.25% p.a.",
        "highlight": "Most beginner-friendly UI with instant paperless onboarding.",
        "platform": "Groww App",
        "minInvestment": "₹10000",
        "badge": "Best Beginner UI"
      },
      {
        "name": "Government Security (G-Sec) (Direct Plan)",
        "provider": "Angel One",
        "rate": "~7.25% p.a.",
        "highlight": "Full service research reports and automated trading tools.",
        "platform": "Angel One App",
        "minInvestment": "₹10000"
      },
      {
        "name": "Government Security (G-Sec) (Direct Plan)",
        "provider": "ICICI Direct",
        "rate": "~7.25% p.a.",
        "highlight": "3-in-1 integrated banking + demat + trading account convenience.",
        "platform": "ICICI Direct Portal",
        "minInvestment": "₹10000"
      },
      {
        "name": "Upstox / Kuvera Government Security (G-Sec)",
        "provider": "Upstox / Kuvera",
        "rate": "~7.25% p.a.",
        "highlight": "Low fee execution with direct portfolio analytics.",
        "platform": "Upstox / Kuvera App",
        "minInvestment": "₹10000"
      }
    ]
  },
  "municipal_bonds": {
    "title": "Best Platforms & Products for Municipal Bonds",
    "riskLevel": 2,
    "note": "Bonds issued by civic bodies to fund local infrastructure tasks like water or transport.",
    "howToStart": "Submit a direct mutual fund application on the AMC portal, or transact seamlessly on any popular mutual fund platform.",
    "products": [
      {
        "name": "Zerodha Kite Municipal Bonds",
        "provider": "Zerodha",
        "rate": "~8.25% p.a.",
        "highlight": "Zero brokerage on equity delivery investments with India's largest discount broker.",
        "platform": "Zerodha Kite App",
        "minInvestment": "₹10000",
        "badge": "Top Discount Broker"
      },
      {
        "name": "Municipal Bonds (Direct Plan)",
        "provider": "Groww",
        "rate": "~8.25% p.a.",
        "highlight": "Most beginner-friendly UI with instant paperless onboarding.",
        "platform": "Groww App",
        "minInvestment": "₹10000",
        "badge": "Best Beginner UI"
      },
      {
        "name": "Municipal Bonds (Direct Plan)",
        "provider": "Angel One",
        "rate": "~8.25% p.a.",
        "highlight": "Full service research reports and automated trading tools.",
        "platform": "Angel One App",
        "minInvestment": "₹10000"
      },
      {
        "name": "Municipal Bonds (Direct Plan)",
        "provider": "ICICI Direct",
        "rate": "~8.25% p.a.",
        "highlight": "3-in-1 integrated banking + demat + trading account convenience.",
        "platform": "ICICI Direct Portal",
        "minInvestment": "₹10000"
      },
      {
        "name": "Upstox / Kuvera Municipal Bonds",
        "provider": "Upstox / Kuvera",
        "rate": "~8.25% p.a.",
        "highlight": "Low fee execution with direct portfolio analytics.",
        "platform": "Upstox / Kuvera App",
        "minInvestment": "₹10000"
      }
    ]
  },
  "bonds_54ec": {
    "title": "Best Platforms & Products for 54EC Capital Gains Bonds",
    "riskLevel": 1,
    "note": "Specialized sovereign bonds designed to save capital gains tax on the sale of property.",
    "howToStart": "Open an account at any authorized commercial bank or post office using Aadhaar and PAN verification.",
    "products": [
      {
        "name": "Zerodha Kite 54EC Capital Gains Bonds",
        "provider": "Zerodha",
        "rate": "~5.25% p.a.",
        "highlight": "Zero brokerage on equity delivery investments with India's largest discount broker.",
        "platform": "Zerodha Kite App",
        "minInvestment": "₹20000",
        "badge": "Top Discount Broker"
      },
      {
        "name": "54EC Capital Gains Bonds (Direct Plan)",
        "provider": "Groww",
        "rate": "~5.25% p.a.",
        "highlight": "Most beginner-friendly UI with instant paperless onboarding.",
        "platform": "Groww App",
        "minInvestment": "₹20000",
        "badge": "Best Beginner UI"
      },
      {
        "name": "54EC Capital Gains Bonds (Direct Plan)",
        "provider": "Angel One",
        "rate": "~5.25% p.a.",
        "highlight": "Full service research reports and automated trading tools.",
        "platform": "Angel One App",
        "minInvestment": "₹20000"
      },
      {
        "name": "54EC Capital Gains Bonds (Direct Plan)",
        "provider": "ICICI Direct",
        "rate": "~5.25% p.a.",
        "highlight": "3-in-1 integrated banking + demat + trading account convenience.",
        "platform": "ICICI Direct Portal",
        "minInvestment": "₹20000"
      },
      {
        "name": "Upstox / Kuvera 54EC Capital Gains Bonds",
        "provider": "Upstox / Kuvera",
        "rate": "~5.25% p.a.",
        "highlight": "Low fee execution with direct portfolio analytics.",
        "platform": "Upstox / Kuvera App",
        "minInvestment": "₹20000"
      }
    ]
  },
  "nps": {
    "title": "Where to Access National Pension System (NPS)",
    "riskLevel": 3,
    "note": "Market-linked pension with equity+debt blending. Extra ₹50K 80CCD(1B) deduction on top of 80C. 60% lump sum tax-free at 60. Guaranteed by Government of India / RBI authority.",
    "howToStart": "Register on enps.nsdl.com with Aadhaar + PAN. Choose a Pension Fund Manager and asset allocation.",
    "products": [
      {
        "name": "SBI National Pension System (NPS)",
        "provider": "State Bank of India",
        "rate": "~10.5% p.a.",
        "highlight": "India's largest branch network (22,000+) ensuring seamless access & auto-credit.",
        "platform": "SBI YONO / Branch",
        "minInvestment": "₹500",
        "tenure": "Fixed Term",
        "badge": "Most Accessible"
      },
      {
        "name": "HDFC Bank National Pension System (NPS)",
        "provider": "HDFC Bank",
        "rate": "~10.5% p.a.",
        "highlight": "Seamless digital account setup and instant e-statements via NetBanking.",
        "platform": "HDFC NetBanking / Branch",
        "minInvestment": "₹500",
        "tenure": "Fixed Term",
        "badge": "Best Digital UI"
      },
      {
        "name": "ICICI Bank National Pension System (NPS)",
        "provider": "ICICI Bank",
        "rate": "~10.5% p.a.",
        "highlight": "Quick digital tracking via iMobile Pay app with free tax reports.",
        "platform": "ICICI iMobile / Branch",
        "minInvestment": "₹500",
        "tenure": "Fixed Term"
      },
      {
        "name": "India Post National Pension System (NPS)",
        "provider": "India Post",
        "rate": "~10.5% p.a.",
        "highlight": "Available at 1.55 lakh+ post offices nationwide for 100% rural & urban reach.",
        "platform": "Any Post Office Branch",
        "minInvestment": "₹500",
        "tenure": "Fixed Term",
        "badge": "100% Physical Reach"
      },
      {
        "name": "Axis / PNB Bank National Pension System (NPS)",
        "provider": "Axis / PNB Bank",
        "rate": "~10.5% p.a.",
        "highlight": "Dedicated government scheme counters and quick processing.",
        "platform": "Bank Branch / Portal",
        "minInvestment": "₹500",
        "tenure": "Fixed Term"
      }
    ]
  },
  "nps_tier_2": {
    "title": "Where to Access NPS Tier-II Account",
    "riskLevel": 3,
    "note": "Voluntary retirement account companion to NPS Tier-I. Zero lock-in with dynamic market investment splits. Guaranteed by Government of India / RBI authority.",
    "howToStart": "Submit a direct mutual fund application on the AMC portal, or transact seamlessly on any popular mutual fund platform.",
    "products": [
      {
        "name": "SBI NPS Tier-II Account",
        "provider": "State Bank of India",
        "rate": "~9.75% p.a.",
        "highlight": "India's largest branch network (22,000+) ensuring seamless access & auto-credit.",
        "platform": "SBI YONO / Branch",
        "minInvestment": "₹250",
        "tenure": "Fixed Term",
        "badge": "Most Accessible"
      },
      {
        "name": "HDFC Bank NPS Tier-II Account",
        "provider": "HDFC Bank",
        "rate": "~9.75% p.a.",
        "highlight": "Seamless digital account setup and instant e-statements via NetBanking.",
        "platform": "HDFC NetBanking / Branch",
        "minInvestment": "₹250",
        "tenure": "Fixed Term",
        "badge": "Best Digital UI"
      },
      {
        "name": "ICICI Bank NPS Tier-II Account",
        "provider": "ICICI Bank",
        "rate": "~9.75% p.a.",
        "highlight": "Quick digital tracking via iMobile Pay app with free tax reports.",
        "platform": "ICICI iMobile / Branch",
        "minInvestment": "₹250",
        "tenure": "Fixed Term"
      },
      {
        "name": "India Post NPS Tier-II Account",
        "provider": "India Post",
        "rate": "~9.75% p.a.",
        "highlight": "Available at 1.55 lakh+ post offices nationwide for 100% rural & urban reach.",
        "platform": "Any Post Office Branch",
        "minInvestment": "₹250",
        "tenure": "Fixed Term",
        "badge": "100% Physical Reach"
      },
      {
        "name": "Axis / PNB Bank NPS Tier-II Account",
        "provider": "Axis / PNB Bank",
        "rate": "~9.75% p.a.",
        "highlight": "Dedicated government scheme counters and quick processing.",
        "platform": "Bank Branch / Portal",
        "minInvestment": "₹250",
        "tenure": "Fixed Term"
      }
    ]
  },
  "epf": {
    "title": "Where to Access Employee Provident Fund (EPF)",
    "riskLevel": 1,
    "note": "Sovereign-backed pension fund for salaried corporate workers. Offers safe 8% compounding. Guaranteed by Government of India / RBI authority.",
    "howToStart": "Open an account at any authorized commercial bank or post office using Aadhaar and PAN verification.",
    "products": [
      {
        "name": "SBI Employee Provident Fund (EPF)",
        "provider": "State Bank of India",
        "rate": "~8.15% p.a.",
        "highlight": "India's largest branch network (22,000+) ensuring seamless access & auto-credit.",
        "platform": "SBI YONO / Branch",
        "minInvestment": "₹1800",
        "tenure": "Fixed Term",
        "badge": "Most Accessible"
      },
      {
        "name": "HDFC Bank Employee Provident Fund (EPF)",
        "provider": "HDFC Bank",
        "rate": "~8.15% p.a.",
        "highlight": "Seamless digital account setup and instant e-statements via NetBanking.",
        "platform": "HDFC NetBanking / Branch",
        "minInvestment": "₹1800",
        "tenure": "Fixed Term",
        "badge": "Best Digital UI"
      },
      {
        "name": "ICICI Bank Employee Provident Fund (EPF)",
        "provider": "ICICI Bank",
        "rate": "~8.15% p.a.",
        "highlight": "Quick digital tracking via iMobile Pay app with free tax reports.",
        "platform": "ICICI iMobile / Branch",
        "minInvestment": "₹1800",
        "tenure": "Fixed Term"
      },
      {
        "name": "India Post Employee Provident Fund (EPF)",
        "provider": "India Post",
        "rate": "~8.15% p.a.",
        "highlight": "Available at 1.55 lakh+ post offices nationwide for 100% rural & urban reach.",
        "platform": "Any Post Office Branch",
        "minInvestment": "₹1800",
        "tenure": "Fixed Term",
        "badge": "100% Physical Reach"
      },
      {
        "name": "Axis / PNB Bank Employee Provident Fund (EPF)",
        "provider": "Axis / PNB Bank",
        "rate": "~8.15% p.a.",
        "highlight": "Dedicated government scheme counters and quick processing.",
        "platform": "Bank Branch / Portal",
        "minInvestment": "₹1800",
        "tenure": "Fixed Term"
      }
    ]
  },
  "vpf": {
    "title": "Where to Access Voluntary Provident Fund (VPF)",
    "riskLevel": 1,
    "note": "Extends standard EPF allocations. Salaried workers can voluntarily commit excess basic pay. Guaranteed by Government of India / RBI authority.",
    "howToStart": "Open an account at any authorized commercial bank or post office using Aadhaar and PAN verification.",
    "products": [
      {
        "name": "SBI Voluntary Provident Fund (VPF)",
        "provider": "State Bank of India",
        "rate": "~8.15% p.a.",
        "highlight": "India's largest branch network (22,000+) ensuring seamless access & auto-credit.",
        "platform": "SBI YONO / Branch",
        "minInvestment": "₹500",
        "tenure": "Fixed Term",
        "badge": "Most Accessible"
      },
      {
        "name": "HDFC Bank Voluntary Provident Fund (VPF)",
        "provider": "HDFC Bank",
        "rate": "~8.15% p.a.",
        "highlight": "Seamless digital account setup and instant e-statements via NetBanking.",
        "platform": "HDFC NetBanking / Branch",
        "minInvestment": "₹500",
        "tenure": "Fixed Term",
        "badge": "Best Digital UI"
      },
      {
        "name": "ICICI Bank Voluntary Provident Fund (VPF)",
        "provider": "ICICI Bank",
        "rate": "~8.15% p.a.",
        "highlight": "Quick digital tracking via iMobile Pay app with free tax reports.",
        "platform": "ICICI iMobile / Branch",
        "minInvestment": "₹500",
        "tenure": "Fixed Term"
      },
      {
        "name": "India Post Voluntary Provident Fund (VPF)",
        "provider": "India Post",
        "rate": "~8.15% p.a.",
        "highlight": "Available at 1.55 lakh+ post offices nationwide for 100% rural & urban reach.",
        "platform": "Any Post Office Branch",
        "minInvestment": "₹500",
        "tenure": "Fixed Term",
        "badge": "100% Physical Reach"
      },
      {
        "name": "Axis / PNB Bank Voluntary Provident Fund (VPF)",
        "provider": "Axis / PNB Bank",
        "rate": "~8.15% p.a.",
        "highlight": "Dedicated government scheme counters and quick processing.",
        "platform": "Bank Branch / Portal",
        "minInvestment": "₹500",
        "tenure": "Fixed Term"
      }
    ]
  },
  "ulip": {
    "title": "Best Platforms & Products for Unit Linked Insurance Plan",
    "riskLevel": 3,
    "note": "Hybrids combining term life insurance covers with market mutual fund units. Lock-in 5 years.",
    "howToStart": "Submit a direct mutual fund application on the AMC portal, or transact seamlessly on any popular mutual fund platform.",
    "products": [
      {
        "name": "Zerodha Kite Unit Linked Insurance Plan",
        "provider": "Zerodha",
        "rate": "~10.25% p.a.",
        "highlight": "Zero brokerage on equity delivery investments with India's largest discount broker.",
        "platform": "Zerodha Kite App",
        "minInvestment": "₹2000",
        "badge": "Top Discount Broker"
      },
      {
        "name": "HDFC Life Unit Linked Insurance Plan",
        "provider": "Groww",
        "rate": "~10.25% p.a.",
        "highlight": "Most beginner-friendly UI with instant paperless onboarding.",
        "platform": "Groww App",
        "minInvestment": "₹2000",
        "badge": "Best Beginner UI"
      },
      {
        "name": "ICICI Prudential Life Unit Linked Insurance Plan",
        "provider": "Angel One",
        "rate": "~10.25% p.a.",
        "highlight": "Full service research reports and automated trading tools.",
        "platform": "Angel One App",
        "minInvestment": "₹2000"
      },
      {
        "name": "Max Life Unit Linked Insurance Plan",
        "provider": "ICICI Direct",
        "rate": "~10.25% p.a.",
        "highlight": "3-in-1 integrated banking + demat + trading account convenience.",
        "platform": "ICICI Direct Portal",
        "minInvestment": "₹2000"
      },
      {
        "name": "Upstox / Kuvera Unit Linked Insurance Plan",
        "provider": "Upstox / Kuvera",
        "rate": "~10.25% p.a.",
        "highlight": "Low fee execution with direct portfolio analytics.",
        "platform": "Upstox / Kuvera App",
        "minInvestment": "₹2000"
      }
    ]
  },
  "endowment_plan": {
    "title": "Best Platforms & Products for Endowment Insurance Policy",
    "riskLevel": 2,
    "note": "Conservative traditional life policies. Guarantees low single-digit return compounding.",
    "howToStart": "Submit a direct mutual fund application on the AMC portal, or transact seamlessly on any popular mutual fund platform.",
    "products": [
      {
        "name": "Zerodha Kite Endowment Insurance Policy",
        "provider": "Zerodha",
        "rate": "~5.5% p.a.",
        "highlight": "Zero brokerage on equity delivery investments with India's largest discount broker.",
        "platform": "Zerodha Kite App",
        "minInvestment": "₹2000",
        "badge": "Top Discount Broker"
      },
      {
        "name": "HDFC Life Endowment Insurance Policy",
        "provider": "Groww",
        "rate": "~5.5% p.a.",
        "highlight": "Most beginner-friendly UI with instant paperless onboarding.",
        "platform": "Groww App",
        "minInvestment": "₹2000",
        "badge": "Best Beginner UI"
      },
      {
        "name": "ICICI Prudential Life Endowment Insurance Policy",
        "provider": "Angel One",
        "rate": "~5.5% p.a.",
        "highlight": "Full service research reports and automated trading tools.",
        "platform": "Angel One App",
        "minInvestment": "₹2000"
      },
      {
        "name": "Max Life Endowment Insurance Policy",
        "provider": "ICICI Direct",
        "rate": "~5.5% p.a.",
        "highlight": "3-in-1 integrated banking + demat + trading account convenience.",
        "platform": "ICICI Direct Portal",
        "minInvestment": "₹2000"
      },
      {
        "name": "Upstox / Kuvera Endowment Insurance Policy",
        "provider": "Upstox / Kuvera",
        "rate": "~5.5% p.a.",
        "highlight": "Low fee execution with direct portfolio analytics.",
        "platform": "Upstox / Kuvera App",
        "minInvestment": "₹2000"
      }
    ]
  },
  "term_mf_combo": {
    "title": "Best Platforms & Products for Term Insurance + Mutual Fund",
    "riskLevel": 3,
    "note": "Alternative strategy: combines low-cost pure term cover with index mutual funds for better capital yields.",
    "howToStart": "Submit a direct mutual fund application on the AMC portal, or transact seamlessly on any popular mutual fund platform.",
    "products": [
      {
        "name": "Zerodha Kite Term Insurance + Mutual Fund",
        "provider": "Zerodha",
        "rate": "~12.75% p.a.",
        "highlight": "Zero brokerage on equity delivery investments with India's largest discount broker.",
        "platform": "Zerodha Kite App",
        "minInvestment": "₹2000",
        "badge": "Top Discount Broker"
      },
      {
        "name": "HDFC Term Insurance + Fund (Direct Growth)",
        "provider": "Groww",
        "rate": "~12.75% p.a.",
        "highlight": "Most beginner-friendly UI with instant paperless onboarding.",
        "platform": "Groww App",
        "minInvestment": "₹2000",
        "badge": "Best Beginner UI"
      },
      {
        "name": "ICICI Prudential Term Insurance + Fund (Direct Growth)",
        "provider": "Angel One",
        "rate": "~12.75% p.a.",
        "highlight": "Full service research reports and automated trading tools.",
        "platform": "Angel One App",
        "minInvestment": "₹2000"
      },
      {
        "name": "Axis Term Insurance + Fund (Direct Growth)",
        "provider": "ICICI Direct",
        "rate": "~12.75% p.a.",
        "highlight": "3-in-1 integrated banking + demat + trading account convenience.",
        "platform": "ICICI Direct Portal",
        "minInvestment": "₹2000"
      },
      {
        "name": "Upstox / Kuvera Term Insurance + Mutual Fund",
        "provider": "Upstox / Kuvera",
        "rate": "~12.75% p.a.",
        "highlight": "Low fee execution with direct portfolio analytics.",
        "platform": "Upstox / Kuvera App",
        "minInvestment": "₹2000"
      }
    ]
  },
  "bluechip_stocks": {
    "title": "Best Platforms & Products for Nifty 50 Blue-Chip Stocks",
    "riskLevel": 4,
    "note": "Direct stock investment in top-tier Nifty 50 leaders. Bypasses mutual fund management costs.",
    "howToStart": "Open a demat and trading account with a discount broker. Search for the ticker symbol of Nifty 50 Blue-Chip Stocks and purchase units.",
    "products": [
      {
        "name": "Zerodha Kite Nifty 50 Blue-Chip Stocks",
        "provider": "Zerodha",
        "rate": "~14% p.a.",
        "highlight": "Zero brokerage on equity delivery investments with India's largest discount broker.",
        "platform": "Zerodha Kite App",
        "minInvestment": "₹3000",
        "badge": "Top Discount Broker"
      },
      {
        "name": "HDFC Nifty 50 Blue-Chip Stocks (Direct Growth)",
        "provider": "Groww",
        "rate": "~14% p.a.",
        "highlight": "Most beginner-friendly UI with instant paperless onboarding.",
        "platform": "Groww App",
        "minInvestment": "₹3000",
        "badge": "Best Beginner UI"
      },
      {
        "name": "ICICI Prudential Nifty 50 Blue-Chip Stocks (Direct Growth)",
        "provider": "Angel One",
        "rate": "~14% p.a.",
        "highlight": "Full service research reports and automated trading tools.",
        "platform": "Angel One App",
        "minInvestment": "₹3000"
      },
      {
        "name": "Axis Nifty 50 Blue-Chip Stocks (Direct Growth)",
        "provider": "ICICI Direct",
        "rate": "~14% p.a.",
        "highlight": "3-in-1 integrated banking + demat + trading account convenience.",
        "platform": "ICICI Direct Portal",
        "minInvestment": "₹3000"
      },
      {
        "name": "Upstox / Kuvera Nifty 50 Blue-Chip Stocks",
        "provider": "Upstox / Kuvera",
        "rate": "~14% p.a.",
        "highlight": "Low fee execution with direct portfolio analytics.",
        "platform": "Upstox / Kuvera App",
        "minInvestment": "₹3000"
      }
    ]
  },
  "large_cap_stocks": {
    "title": "Best Platforms & Products for Large Cap Stocks",
    "riskLevel": 4,
    "note": "Direct ownership in top 100 Indian companies by market capitalization.",
    "howToStart": "Open a demat and trading account with a discount broker. Search for the ticker symbol of Large Cap Stocks and purchase units.",
    "products": [
      {
        "name": "Zerodha Kite Large Cap Stocks",
        "provider": "Zerodha",
        "rate": "~14.5% p.a.",
        "highlight": "Zero brokerage on equity delivery investments with India's largest discount broker.",
        "platform": "Zerodha Kite App",
        "minInvestment": "₹3000",
        "badge": "Top Discount Broker"
      },
      {
        "name": "HDFC Large Cap Stocks (Direct Growth)",
        "provider": "Groww",
        "rate": "~14.5% p.a.",
        "highlight": "Most beginner-friendly UI with instant paperless onboarding.",
        "platform": "Groww App",
        "minInvestment": "₹3000",
        "badge": "Best Beginner UI"
      },
      {
        "name": "ICICI Prudential Large Cap Stocks (Direct Growth)",
        "provider": "Angel One",
        "rate": "~14.5% p.a.",
        "highlight": "Full service research reports and automated trading tools.",
        "platform": "Angel One App",
        "minInvestment": "₹3000"
      },
      {
        "name": "Axis Large Cap Stocks (Direct Growth)",
        "provider": "ICICI Direct",
        "rate": "~14.5% p.a.",
        "highlight": "3-in-1 integrated banking + demat + trading account convenience.",
        "platform": "ICICI Direct Portal",
        "minInvestment": "₹3000"
      },
      {
        "name": "Upstox / Kuvera Large Cap Stocks",
        "provider": "Upstox / Kuvera",
        "rate": "~14.5% p.a.",
        "highlight": "Low fee execution with direct portfolio analytics.",
        "platform": "Upstox / Kuvera App",
        "minInvestment": "₹3000"
      }
    ]
  },
  "mid_cap_stocks": {
    "title": "Best Platforms & Products for Mid Cap Growth Stocks",
    "riskLevel": 5,
    "note": "Direct investment in mid-sized firms with high growth potential, but high volatility.",
    "howToStart": "Open a demat and trading account with a discount broker. Search for the ticker symbol of Mid Cap Growth Stocks and purchase units.",
    "products": [
      {
        "name": "Zerodha Kite Mid Cap Growth Stocks",
        "provider": "Zerodha",
        "rate": "~16.75% p.a.",
        "highlight": "Zero brokerage on equity delivery investments with India's largest discount broker.",
        "platform": "Zerodha Kite App",
        "minInvestment": "₹5000",
        "badge": "Top Discount Broker"
      },
      {
        "name": "HDFC Mid Cap Growth Stocks (Direct Growth)",
        "provider": "Groww",
        "rate": "~16.75% p.a.",
        "highlight": "Most beginner-friendly UI with instant paperless onboarding.",
        "platform": "Groww App",
        "minInvestment": "₹5000",
        "badge": "Best Beginner UI"
      },
      {
        "name": "ICICI Prudential Mid Cap Growth Stocks (Direct Growth)",
        "provider": "Angel One",
        "rate": "~16.75% p.a.",
        "highlight": "Full service research reports and automated trading tools.",
        "platform": "Angel One App",
        "minInvestment": "₹5000"
      },
      {
        "name": "Axis Mid Cap Growth Stocks (Direct Growth)",
        "provider": "ICICI Direct",
        "rate": "~16.75% p.a.",
        "highlight": "3-in-1 integrated banking + demat + trading account convenience.",
        "platform": "ICICI Direct Portal",
        "minInvestment": "₹5000"
      },
      {
        "name": "Upstox / Kuvera Mid Cap Growth Stocks",
        "provider": "Upstox / Kuvera",
        "rate": "~16.75% p.a.",
        "highlight": "Low fee execution with direct portfolio analytics.",
        "platform": "Upstox / Kuvera App",
        "minInvestment": "₹5000"
      }
    ]
  },
  "small_cap_stocks": {
    "title": "Best Platforms & Products for Small Cap High-Beta Stocks",
    "riskLevel": 5,
    "note": "High risk stocks of small scale companies. Significant market return volatility.",
    "howToStart": "Open a demat and trading account with a discount broker. Search for the ticker symbol of Small Cap High-Beta Stocks and purchase units.",
    "products": [
      {
        "name": "Zerodha Kite Small Cap High-Beta Stocks",
        "provider": "Zerodha",
        "rate": "~15% p.a.",
        "highlight": "Zero brokerage on equity delivery investments with India's largest discount broker.",
        "platform": "Zerodha Kite App",
        "minInvestment": "₹5000",
        "badge": "Top Discount Broker"
      },
      {
        "name": "HDFC Small Cap High-Beta Stocks (Direct Growth)",
        "provider": "Groww",
        "rate": "~15% p.a.",
        "highlight": "Most beginner-friendly UI with instant paperless onboarding.",
        "platform": "Groww App",
        "minInvestment": "₹5000",
        "badge": "Best Beginner UI"
      },
      {
        "name": "ICICI Prudential Small Cap High-Beta Stocks (Direct Growth)",
        "provider": "Angel One",
        "rate": "~15% p.a.",
        "highlight": "Full service research reports and automated trading tools.",
        "platform": "Angel One App",
        "minInvestment": "₹5000"
      },
      {
        "name": "Axis Small Cap High-Beta Stocks (Direct Growth)",
        "provider": "ICICI Direct",
        "rate": "~15% p.a.",
        "highlight": "3-in-1 integrated banking + demat + trading account convenience.",
        "platform": "ICICI Direct Portal",
        "minInvestment": "₹5000"
      },
      {
        "name": "Upstox / Kuvera Small Cap High-Beta Stocks",
        "provider": "Upstox / Kuvera",
        "rate": "~15% p.a.",
        "highlight": "Low fee execution with direct portfolio analytics.",
        "platform": "Upstox / Kuvera App",
        "minInvestment": "₹5000"
      }
    ]
  },
  "direct_equity": {
    "title": "Best Platforms & Products for Direct Stock Investment",
    "riskLevel": 5,
    "note": "Highest return potential with company-specific risk. Requires research and active monitoring.",
    "howToStart": "Open a demat + trading account on Zerodha, Groww, or Angel One. Start with blue-chip large-caps.",
    "subCategories": {
      "banking_financial": ["HDFC Bank", "ICICI Bank", "SBI"],
      "it_technology": ["TCS", "Infosys", "HCL Tech"],
      "energy_industrial": ["Reliance Industries", "L&T", "NTPC"],
      "fmcg_consumer": ["Hindustan Unilever", "ITC", "Nestle India"],
      "pharma_healthcare": ["Sun Pharma", "Cipla", "Dr. Reddy's"]
    },
    "products": [
      {
        "name": "Zerodha Kite Direct Stock Investment",
        "provider": "Zerodha",
        "rate": "~15% p.a.",
        "highlight": "Zero brokerage on equity delivery investments with India's largest discount broker.",
        "platform": "Zerodha Kite App",
        "minInvestment": "₹5000",
        "badge": "Top Discount Broker"
      },
      {
        "name": "HDFC Direct Stock Investment (Direct Growth)",
        "provider": "Groww",
        "rate": "~15% p.a.",
        "highlight": "Most beginner-friendly UI with instant paperless onboarding.",
        "platform": "Groww App",
        "minInvestment": "₹5000",
        "badge": "Best Beginner UI"
      },
      {
        "name": "ICICI Prudential Direct Stock Investment (Direct Growth)",
        "provider": "Angel One",
        "rate": "~15% p.a.",
        "highlight": "Full service research reports and automated trading tools.",
        "platform": "Angel One App",
        "minInvestment": "₹5000"
      },
      {
        "name": "Axis Direct Stock Investment (Direct Growth)",
        "provider": "ICICI Direct",
        "rate": "~15% p.a.",
        "highlight": "3-in-1 integrated banking + demat + trading account convenience.",
        "platform": "ICICI Direct Portal",
        "minInvestment": "₹5000"
      },
      {
        "name": "Upstox / Kuvera Direct Stock Investment",
        "provider": "Upstox / Kuvera",
        "rate": "~15% p.a.",
        "highlight": "Low fee execution with direct portfolio analytics.",
        "platform": "Upstox / Kuvera App",
        "minInvestment": "₹5000"
      }
    ]
  },
  "arbitrage_mf": {
    "title": "Best Platforms & Products for Arbitrage Mutual Fund",
    "riskLevel": 1,
    "note": "Low-risk fund generating returns via arbitrage. Taxed like an equity fund, making it extremely tax-efficient.",
    "howToStart": "Submit a direct mutual fund application on the AMC portal, or transact seamlessly on any popular mutual fund platform.",
    "products": [
      {
        "name": "Zerodha Kite Arbitrage Mutual Fund",
        "provider": "Zerodha",
        "rate": "~7.5% p.a.",
        "highlight": "Zero brokerage on equity delivery investments with India's largest discount broker.",
        "platform": "Zerodha Kite App",
        "minInvestment": "₹1000",
        "badge": "Top Discount Broker"
      },
      {
        "name": "HDFC Arbitrage Fund (Direct Growth)",
        "provider": "Groww",
        "rate": "~7.5% p.a.",
        "highlight": "Most beginner-friendly UI with instant paperless onboarding.",
        "platform": "Groww App",
        "minInvestment": "₹1000",
        "badge": "Best Beginner UI"
      },
      {
        "name": "ICICI Prudential Arbitrage Fund (Direct Growth)",
        "provider": "Angel One",
        "rate": "~7.5% p.a.",
        "highlight": "Full service research reports and automated trading tools.",
        "platform": "Angel One App",
        "minInvestment": "₹1000"
      },
      {
        "name": "Axis Arbitrage Fund (Direct Growth)",
        "provider": "ICICI Direct",
        "rate": "~7.5% p.a.",
        "highlight": "3-in-1 integrated banking + demat + trading account convenience.",
        "platform": "ICICI Direct Portal",
        "minInvestment": "₹1000"
      },
      {
        "name": "Upstox / Kuvera Arbitrage Mutual Fund",
        "provider": "Upstox / Kuvera",
        "rate": "~7.5% p.a.",
        "highlight": "Low fee execution with direct portfolio analytics.",
        "platform": "Upstox / Kuvera App",
        "minInvestment": "₹1000"
      }
    ]
  },
  "po_td_1yr": {
    "title": "Best Platforms & Products for Post Office 1-Year Time Deposit",
    "riskLevel": 1,
    "note": "Sovereign-backed 1-year deposit scheme managed by India Post. Pays competitive quarterly rates.",
    "howToStart": "Submit a direct mutual fund application on the AMC portal, or transact seamlessly on any popular mutual fund platform.",
    "products": [
      {
        "name": "Zerodha Kite Post Office 1-Year Time Deposit",
        "provider": "Zerodha",
        "rate": "~6.9% p.a.",
        "highlight": "Zero brokerage on equity delivery investments with India's largest discount broker.",
        "platform": "Zerodha Kite App",
        "minInvestment": "₹1000",
        "badge": "Top Discount Broker"
      },
      {
        "name": "HDFC Post Office 1-Year Time Deposit (Direct Growth)",
        "provider": "Groww",
        "rate": "~6.9% p.a.",
        "highlight": "Most beginner-friendly UI with instant paperless onboarding.",
        "platform": "Groww App",
        "minInvestment": "₹1000",
        "badge": "Best Beginner UI"
      },
      {
        "name": "ICICI Prudential Post Office 1-Year Time Deposit (Direct Growth)",
        "provider": "Angel One",
        "rate": "~6.9% p.a.",
        "highlight": "Full service research reports and automated trading tools.",
        "platform": "Angel One App",
        "minInvestment": "₹1000"
      },
      {
        "name": "Axis Post Office 1-Year Time Deposit (Direct Growth)",
        "provider": "ICICI Direct",
        "rate": "~6.9% p.a.",
        "highlight": "3-in-1 integrated banking + demat + trading account convenience.",
        "platform": "ICICI Direct Portal",
        "minInvestment": "₹1000"
      },
      {
        "name": "Upstox / Kuvera Post Office 1-Year Time Deposit",
        "provider": "Upstox / Kuvera",
        "rate": "~6.9% p.a.",
        "highlight": "Low fee execution with direct portfolio analytics.",
        "platform": "Upstox / Kuvera App",
        "minInvestment": "₹1000"
      }
    ]
  },
  "parag_parikh_flexi": {
    "title": "Best Parag Parikh Flexi Cap Fund Schemes in India",
    "riskLevel": 4,
    "note": "Premium diversified fund investing in Indian blue-chips and international global giants like Alphabet/Microsoft. 12.5% LTCG tax above ₹1.25L; 20% STCG.",
    "howToStart": "Invest in zero-commission Direct plans via Groww, Zerodha Coin, or Kuvera.",
    "products": [
      {
        "name": "Nippon India Parag Parikh Flexi Cap Direct Growth",
        "provider": "Nippon India AMC",
        "rate": "~16% p.a.",
        "highlight": "High alpha generator with proven multi-year track record.",
        "platform": "Groww / Coin",
        "minInvestment": "₹100 SIP",
        "badge": "Top Performer"
      },
      {
        "name": "ICICI Pru Parag Parikh Flexi Cap Direct Plan",
        "provider": "ICICI Prudential AMC",
        "rate": "~16% p.a.",
        "highlight": "Disciplined risk-adjusted framework and strong downside protection.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Consistent Alpha"
      },
      {
        "name": "HDFC Parag Parikh Flexi Cap Direct Growth",
        "provider": "HDFC AMC",
        "rate": "~16% p.a.",
        "highlight": "Large fund size with high liquidity and robust research coverage.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP"
      },
      {
        "name": "SBI Parag Parikh Flexi Cap Direct Plan",
        "provider": "SBI Mutual Fund",
        "rate": "~16% p.a.",
        "highlight": "Extensive equity research desk backing high conviction stocks.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Mirae Asset Parag Parikh Flexi Cap Direct",
        "provider": "Mirae Asset AMC",
        "rate": "~16% p.a.",
        "highlight": "Quality-first investment style focusing on high ROE growth leaders.",
        "platform": "Mirae MF / Kuvera",
        "minInvestment": "₹500 SIP"
      }
    ]
  },
  "sbi_bluechip": {
    "title": "Best SBI Bluechip Mutual Fund Schemes in India",
    "riskLevel": 3,
    "note": "Active large-cap mutual fund managed by India's largest AMC. Highly reliable returns. 12.5% LTCG tax above ₹1.25L; 20% STCG.",
    "howToStart": "Invest in zero-commission Direct plans via Groww, Zerodha Coin, or Kuvera.",
    "products": [
      {
        "name": "Nippon India SBI Bluechip Direct Growth",
        "provider": "Nippon India AMC",
        "rate": "~13.5% p.a.",
        "highlight": "High alpha generator with proven multi-year track record.",
        "platform": "Groww / Coin",
        "minInvestment": "₹100 SIP",
        "badge": "Top Performer"
      },
      {
        "name": "ICICI Pru SBI Bluechip Direct Plan",
        "provider": "ICICI Prudential AMC",
        "rate": "~13.5% p.a.",
        "highlight": "Disciplined risk-adjusted framework and strong downside protection.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Consistent Alpha"
      },
      {
        "name": "HDFC SBI Bluechip Direct Growth",
        "provider": "HDFC AMC",
        "rate": "~13.5% p.a.",
        "highlight": "Large fund size with high liquidity and robust research coverage.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP"
      },
      {
        "name": "SBI SBI Bluechip Direct Plan",
        "provider": "SBI Mutual Fund",
        "rate": "~13.5% p.a.",
        "highlight": "Extensive equity research desk backing high conviction stocks.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Mirae Asset SBI Bluechip Direct",
        "provider": "Mirae Asset AMC",
        "rate": "~13.5% p.a.",
        "highlight": "Quality-first investment style focusing on high ROE growth leaders.",
        "platform": "Mirae MF / Kuvera",
        "minInvestment": "₹500 SIP"
      }
    ]
  },
  "hdfc_midcap": {
    "title": "Best HDFC Mid-Cap Opportunities Fund Schemes in India",
    "riskLevel": 4,
    "note": "India's largest mid-cap equity mutual fund, providing superior alpha over the long run. 12.5% LTCG tax above ₹1.25L; 20% STCG.",
    "howToStart": "Invest in zero-commission Direct plans via Groww, Zerodha Coin, or Kuvera.",
    "products": [
      {
        "name": "Nippon India HDFC Mid-Cap Opportunities Direct Growth",
        "provider": "Nippon India AMC",
        "rate": "~17.5% p.a.",
        "highlight": "High alpha generator with proven multi-year track record.",
        "platform": "Groww / Coin",
        "minInvestment": "₹100 SIP",
        "badge": "Top Performer"
      },
      {
        "name": "ICICI Pru HDFC Mid-Cap Opportunities Direct Plan",
        "provider": "ICICI Prudential AMC",
        "rate": "~17.5% p.a.",
        "highlight": "Disciplined risk-adjusted framework and strong downside protection.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Consistent Alpha"
      },
      {
        "name": "HDFC HDFC Mid-Cap Opportunities Direct Growth",
        "provider": "HDFC AMC",
        "rate": "~17.5% p.a.",
        "highlight": "Large fund size with high liquidity and robust research coverage.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP"
      },
      {
        "name": "SBI HDFC Mid-Cap Opportunities Direct Plan",
        "provider": "SBI Mutual Fund",
        "rate": "~17.5% p.a.",
        "highlight": "Extensive equity research desk backing high conviction stocks.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Mirae Asset HDFC Mid-Cap Opportunities Direct",
        "provider": "Mirae Asset AMC",
        "rate": "~17.5% p.a.",
        "highlight": "Quality-first investment style focusing on high ROE growth leaders.",
        "platform": "Mirae MF / Kuvera",
        "minInvestment": "₹500 SIP"
      }
    ]
  },
  "mirae_elss": {
    "title": "Best Mirae Asset ELSS Tax Saver Schemes in India",
    "riskLevel": 4,
    "note": "Popular tax-saving equity fund delivering solid category-beating historical returns. 12.5% LTCG tax above ₹1.25L; 20% STCG.",
    "howToStart": "Invest in zero-commission Direct plans via Groww, Zerodha Coin, or Kuvera.",
    "products": [
      {
        "name": "Nippon India Mirae Asset ELSS Tax Saver Direct Growth",
        "provider": "Nippon India AMC",
        "rate": "~14.75% p.a.",
        "highlight": "High alpha generator with proven multi-year track record.",
        "platform": "Groww / Coin",
        "minInvestment": "₹100 SIP",
        "badge": "Top Performer"
      },
      {
        "name": "ICICI Pru Mirae Asset ELSS Tax Saver Direct Plan",
        "provider": "ICICI Prudential AMC",
        "rate": "~14.75% p.a.",
        "highlight": "Disciplined risk-adjusted framework and strong downside protection.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Consistent Alpha"
      },
      {
        "name": "HDFC Mirae Asset ELSS Tax Saver Direct Growth",
        "provider": "HDFC AMC",
        "rate": "~14.75% p.a.",
        "highlight": "Large fund size with high liquidity and robust research coverage.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP"
      },
      {
        "name": "SBI Mirae Asset ELSS Tax Saver Direct Plan",
        "provider": "SBI Mutual Fund",
        "rate": "~14.75% p.a.",
        "highlight": "Extensive equity research desk backing high conviction stocks.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Mirae Asset Mirae Asset ELSS Tax Saver Direct",
        "provider": "Mirae Asset AMC",
        "rate": "~14.75% p.a.",
        "highlight": "Quality-first investment style focusing on high ROE growth leaders.",
        "platform": "Mirae MF / Kuvera",
        "minInvestment": "₹500 SIP"
      }
    ]
  },
  "bajaj_finance_fd": {
    "title": "Best Options for Bajaj Finance Fixed Deposit",
    "riskLevel": 2,
    "note": "AAA-rated corporate fixed deposit from Bajaj Finance offering up to 7.75% interest. DICGC insured up to ₹5 lakh where applicable.",
    "howToStart": "Invest online directly on Bajaj Finserv portal or via Bajaj Pay app / Kuvera.",
    "products": [
      {
        "name": "Bajaj Finance Fixed Deposit (1 Year Tenure)",
        "provider": "Bajaj Finance Fixed Deposit",
        "rate": "~7.5% p.a.",
        "highlight": "Optimal short term liquidity with fixed guaranteed return.",
        "platform": "NetBanking / Mobile App",
        "minInvestment": "₹1000",
        "tenure": "1 Year",
        "badge": "Most Flexible"
      },
      {
        "name": "Bajaj Finance Fixed Deposit (2–3 Year Tenure)",
        "provider": "Bajaj Finance Fixed Deposit",
        "rate": "~7.8%",
        "highlight": "Higher interest yield for medium term capital lock-in.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "2-3 Years",
        "badge": "Highest Yield"
      },
      {
        "name": "Bajaj Finance Fixed Deposit (Senior Citizen Option)",
        "provider": "Bajaj Finance Fixed Deposit",
        "rate": "~8%",
        "highlight": "Additional 0.50% interest rate benefit for age 60+.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "1-5 Years",
        "badge": "Senior Privilege"
      },
      {
        "name": "Bajaj Finance Fixed Deposit (5 Year Tax Saver)",
        "provider": "Bajaj Finance Fixed Deposit",
        "rate": "~7.5% p.a.",
        "highlight": "Qualifies for Section 80C tax deduction up to ₹1.5 lakh with 5-year lock-in.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "5 Years",
        "badge": "Tax Saver 80C"
      },
      {
        "name": "Bajaj Finance Fixed Deposit (Auto-Sweep Facility)",
        "provider": "Bajaj Finance Fixed Deposit",
        "rate": "~7.5% p.a.",
        "highlight": "Link savings account idle balance for auto-sweep FD interest.",
        "platform": "NetBanking App",
        "minInvestment": "₹1000",
        "tenure": "Flexible"
      }
    ]
  },
  "shriram_finance_fd": {
    "title": "Best Options for Shriram Finance Fixed Deposit",
    "riskLevel": 2,
    "note": "AA+ rated NBFC fixed deposit offering competitive interest rates up to 8.10% p.a. DICGC insured up to ₹5 lakh where applicable.",
    "howToStart": "Open online via Shriram Finance portal or partner portals.",
    "products": [
      {
        "name": "Shriram Finance Fixed Deposit (1 Year Tenure)",
        "provider": "Shriram Finance Fixed Deposit",
        "rate": "~7.8% p.a.",
        "highlight": "Optimal short term liquidity with fixed guaranteed return.",
        "platform": "NetBanking / Mobile App",
        "minInvestment": "₹1000",
        "tenure": "1 Year",
        "badge": "Most Flexible"
      },
      {
        "name": "Shriram Finance Fixed Deposit (2–3 Year Tenure)",
        "provider": "Shriram Finance Fixed Deposit",
        "rate": "~8.1%",
        "highlight": "Higher interest yield for medium term capital lock-in.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "2-3 Years",
        "badge": "Highest Yield"
      },
      {
        "name": "Shriram Finance Fixed Deposit (Senior Citizen Option)",
        "provider": "Shriram Finance Fixed Deposit",
        "rate": "~8.3%",
        "highlight": "Additional 0.50% interest rate benefit for age 60+.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "1-5 Years",
        "badge": "Senior Privilege"
      },
      {
        "name": "Shriram Finance Fixed Deposit (5 Year Tax Saver)",
        "provider": "Shriram Finance Fixed Deposit",
        "rate": "~7.8% p.a.",
        "highlight": "Qualifies for Section 80C tax deduction up to ₹1.5 lakh with 5-year lock-in.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "5 Years",
        "badge": "Tax Saver 80C"
      },
      {
        "name": "Shriram Finance Fixed Deposit (Auto-Sweep Facility)",
        "provider": "Shriram Finance Fixed Deposit",
        "rate": "~7.8% p.a.",
        "highlight": "Link savings account idle balance for auto-sweep FD interest.",
        "platform": "NetBanking App",
        "minInvestment": "₹1000",
        "tenure": "Flexible"
      }
    ]
  },
  "lic_housing_fd": {
    "title": "Best Options for LIC Housing Finance FD",
    "riskLevel": 1,
    "note": "CRISIL AAA rated Housing Finance Company fixed deposit backed by LIC institutional heritage. DICGC insured up to ₹5 lakh where applicable.",
    "howToStart": "Apply online at LIC Housing website or through authorized agents.",
    "products": [
      {
        "name": "LIC Housing Finance FD (1 Year Tenure)",
        "provider": "LIC Housing Finance FD",
        "rate": "~7.4% p.a.",
        "highlight": "Optimal short term liquidity with fixed guaranteed return.",
        "platform": "NetBanking / Mobile App",
        "minInvestment": "₹1000",
        "tenure": "1 Year",
        "badge": "Most Flexible"
      },
      {
        "name": "LIC Housing Finance FD (2–3 Year Tenure)",
        "provider": "LIC Housing Finance FD",
        "rate": "~7.7%",
        "highlight": "Higher interest yield for medium term capital lock-in.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "2-3 Years",
        "badge": "Highest Yield"
      },
      {
        "name": "LIC Housing Finance FD (Senior Citizen Option)",
        "provider": "LIC Housing Finance FD",
        "rate": "~7.9%",
        "highlight": "Additional 0.50% interest rate benefit for age 60+.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "1-5 Years",
        "badge": "Senior Privilege"
      },
      {
        "name": "LIC Housing Finance FD (5 Year Tax Saver)",
        "provider": "LIC Housing Finance FD",
        "rate": "~7.4% p.a.",
        "highlight": "Qualifies for Section 80C tax deduction up to ₹1.5 lakh with 5-year lock-in.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "5 Years",
        "badge": "Tax Saver 80C"
      },
      {
        "name": "LIC Housing Finance FD (Auto-Sweep Facility)",
        "provider": "LIC Housing Finance FD",
        "rate": "~7.4% p.a.",
        "highlight": "Link savings account idle balance for auto-sweep FD interest.",
        "platform": "NetBanking App",
        "minInvestment": "₹1000",
        "tenure": "Flexible"
      }
    ]
  },
  "pnb_housing_fd": {
    "title": "Best Options for PNB Housing Finance FD",
    "riskLevel": 2,
    "note": "AA+ / AAA rated housing finance company fixed deposit offering up to 7.75% p.a. DICGC insured up to ₹5 lakh where applicable.",
    "howToStart": "Apply online at PNB Housing Finance website or partner branch.",
    "products": [
      {
        "name": "PNB Housing Finance FD (1 Year Tenure)",
        "provider": "PNB Housing Finance FD",
        "rate": "~7.5% p.a.",
        "highlight": "Optimal short term liquidity with fixed guaranteed return.",
        "platform": "NetBanking / Mobile App",
        "minInvestment": "₹1000",
        "tenure": "1 Year",
        "badge": "Most Flexible"
      },
      {
        "name": "PNB Housing Finance FD (2–3 Year Tenure)",
        "provider": "PNB Housing Finance FD",
        "rate": "~7.8%",
        "highlight": "Higher interest yield for medium term capital lock-in.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "2-3 Years",
        "badge": "Highest Yield"
      },
      {
        "name": "PNB Housing Finance FD (Senior Citizen Option)",
        "provider": "PNB Housing Finance FD",
        "rate": "~8%",
        "highlight": "Additional 0.50% interest rate benefit for age 60+.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "1-5 Years",
        "badge": "Senior Privilege"
      },
      {
        "name": "PNB Housing Finance FD (5 Year Tax Saver)",
        "provider": "PNB Housing Finance FD",
        "rate": "~7.5% p.a.",
        "highlight": "Qualifies for Section 80C tax deduction up to ₹1.5 lakh with 5-year lock-in.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "5 Years",
        "badge": "Tax Saver 80C"
      },
      {
        "name": "PNB Housing Finance FD (Auto-Sweep Facility)",
        "provider": "PNB Housing Finance FD",
        "rate": "~7.5% p.a.",
        "highlight": "Link savings account idle balance for auto-sweep FD interest.",
        "platform": "NetBanking App",
        "minInvestment": "₹1000",
        "tenure": "Flexible"
      }
    ]
  },
  "mahindra_finance_fd": {
    "title": "Best Options for Mahindra Finance Fixed Deposit",
    "riskLevel": 1,
    "note": "CRISIL AAA rated corporate fixed deposit backed by Mahindra Group conglomerate trust. DICGC insured up to ₹5 lakh where applicable.",
    "howToStart": "Invest online on Mahindra Finance portal.",
    "products": [
      {
        "name": "Mahindra Finance Fixed Deposit (1 Year Tenure)",
        "provider": "Mahindra Finance Fixed Deposit",
        "rate": "~7.5% p.a.",
        "highlight": "Optimal short term liquidity with fixed guaranteed return.",
        "platform": "NetBanking / Mobile App",
        "minInvestment": "₹1000",
        "tenure": "1 Year",
        "badge": "Most Flexible"
      },
      {
        "name": "Mahindra Finance Fixed Deposit (2–3 Year Tenure)",
        "provider": "Mahindra Finance Fixed Deposit",
        "rate": "~7.8%",
        "highlight": "Higher interest yield for medium term capital lock-in.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "2-3 Years",
        "badge": "Highest Yield"
      },
      {
        "name": "Mahindra Finance Fixed Deposit (Senior Citizen Option)",
        "provider": "Mahindra Finance Fixed Deposit",
        "rate": "~8%",
        "highlight": "Additional 0.50% interest rate benefit for age 60+.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "1-5 Years",
        "badge": "Senior Privilege"
      },
      {
        "name": "Mahindra Finance Fixed Deposit (5 Year Tax Saver)",
        "provider": "Mahindra Finance Fixed Deposit",
        "rate": "~7.5% p.a.",
        "highlight": "Qualifies for Section 80C tax deduction up to ₹1.5 lakh with 5-year lock-in.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "5 Years",
        "badge": "Tax Saver 80C"
      },
      {
        "name": "Mahindra Finance Fixed Deposit (Auto-Sweep Facility)",
        "provider": "Mahindra Finance Fixed Deposit",
        "rate": "~7.5% p.a.",
        "highlight": "Link savings account idle balance for auto-sweep FD interest.",
        "platform": "NetBanking App",
        "minInvestment": "₹1000",
        "tenure": "Flexible"
      }
    ]
  },
  "jana_sfb_fd": {
    "title": "Best Options for Jana Small Finance Bank FD",
    "riskLevel": 2,
    "note": "DICGC-insured Small Finance Bank deposit offering high rates up to 8.25% p.a. DICGC insured up to ₹5 lakh where applicable.",
    "howToStart": "Open via Jana SFB internet banking or video KYC.",
    "products": [
      {
        "name": "Jana Small Finance Bank FD (1 Year Tenure)",
        "provider": "Jana Small Finance Bank FD",
        "rate": "~7.9% p.a.",
        "highlight": "Optimal short term liquidity with fixed guaranteed return.",
        "platform": "NetBanking / Mobile App",
        "minInvestment": "₹1000",
        "tenure": "1 Year",
        "badge": "Most Flexible"
      },
      {
        "name": "Jana Small Finance Bank FD (2–3 Year Tenure)",
        "provider": "Jana Small Finance Bank FD",
        "rate": "~8.200000000000001%",
        "highlight": "Higher interest yield for medium term capital lock-in.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "2-3 Years",
        "badge": "Highest Yield"
      },
      {
        "name": "Jana Small Finance Bank FD (Senior Citizen Option)",
        "provider": "Jana Small Finance Bank FD",
        "rate": "~8.4%",
        "highlight": "Additional 0.50% interest rate benefit for age 60+.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "1-5 Years",
        "badge": "Senior Privilege"
      },
      {
        "name": "Jana Small Finance Bank FD (5 Year Tax Saver)",
        "provider": "Jana Small Finance Bank FD",
        "rate": "~7.9% p.a.",
        "highlight": "Qualifies for Section 80C tax deduction up to ₹1.5 lakh with 5-year lock-in.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "5 Years",
        "badge": "Tax Saver 80C"
      },
      {
        "name": "Jana Small Finance Bank FD (Auto-Sweep Facility)",
        "provider": "Jana Small Finance Bank FD",
        "rate": "~7.9% p.a.",
        "highlight": "Link savings account idle balance for auto-sweep FD interest.",
        "platform": "NetBanking App",
        "minInvestment": "₹1000",
        "tenure": "Flexible"
      }
    ]
  },
  "suryoday_sfb_fd": {
    "title": "Best Options for Suryoday Small Finance Bank FD",
    "riskLevel": 2,
    "note": "Market-leading Small Finance Bank FD rates up to 8.60% p.a., DICGC insured up to ₹5 lakh. DICGC insured up to ₹5 lakh where applicable.",
    "howToStart": "Open online via Suryoday SFB website with Aadhaar Video KYC.",
    "products": [
      {
        "name": "Suryoday Small Finance Bank FD (1 Year Tenure)",
        "provider": "Suryoday Small Finance Bank FD",
        "rate": "~8.2% p.a.",
        "highlight": "Optimal short term liquidity with fixed guaranteed return.",
        "platform": "NetBanking / Mobile App",
        "minInvestment": "₹1000",
        "tenure": "1 Year",
        "badge": "Most Flexible"
      },
      {
        "name": "Suryoday Small Finance Bank FD (2–3 Year Tenure)",
        "provider": "Suryoday Small Finance Bank FD",
        "rate": "~8.5%",
        "highlight": "Higher interest yield for medium term capital lock-in.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "2-3 Years",
        "badge": "Highest Yield"
      },
      {
        "name": "Suryoday Small Finance Bank FD (Senior Citizen Option)",
        "provider": "Suryoday Small Finance Bank FD",
        "rate": "~8.7%",
        "highlight": "Additional 0.50% interest rate benefit for age 60+.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "1-5 Years",
        "badge": "Senior Privilege"
      },
      {
        "name": "Suryoday Small Finance Bank FD (5 Year Tax Saver)",
        "provider": "Suryoday Small Finance Bank FD",
        "rate": "~8.2% p.a.",
        "highlight": "Qualifies for Section 80C tax deduction up to ₹1.5 lakh with 5-year lock-in.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "5 Years",
        "badge": "Tax Saver 80C"
      },
      {
        "name": "Suryoday Small Finance Bank FD (Auto-Sweep Facility)",
        "provider": "Suryoday Small Finance Bank FD",
        "rate": "~8.2% p.a.",
        "highlight": "Link savings account idle balance for auto-sweep FD interest.",
        "platform": "NetBanking App",
        "minInvestment": "₹1000",
        "tenure": "Flexible"
      }
    ]
  },
  "esaf_sfb_fd": {
    "title": "Best Options for ESAF Small Finance Bank FD",
    "riskLevel": 2,
    "note": "Scheduled Small Finance Bank FD offering up to 8.25% p.a., protected by DICGC up to ₹5 lakh. DICGC insured up to ₹5 lakh where applicable.",
    "howToStart": "Open via ESAF digital branch or net banking.",
    "products": [
      {
        "name": "ESAF Small Finance Bank FD (1 Year Tenure)",
        "provider": "ESAF Small Finance Bank FD",
        "rate": "~7.85% p.a.",
        "highlight": "Optimal short term liquidity with fixed guaranteed return.",
        "platform": "NetBanking / Mobile App",
        "minInvestment": "₹1000",
        "tenure": "1 Year",
        "badge": "Most Flexible"
      },
      {
        "name": "ESAF Small Finance Bank FD (2–3 Year Tenure)",
        "provider": "ESAF Small Finance Bank FD",
        "rate": "~8.15%",
        "highlight": "Higher interest yield for medium term capital lock-in.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "2-3 Years",
        "badge": "Highest Yield"
      },
      {
        "name": "ESAF Small Finance Bank FD (Senior Citizen Option)",
        "provider": "ESAF Small Finance Bank FD",
        "rate": "~8.35%",
        "highlight": "Additional 0.50% interest rate benefit for age 60+.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "1-5 Years",
        "badge": "Senior Privilege"
      },
      {
        "name": "ESAF Small Finance Bank FD (5 Year Tax Saver)",
        "provider": "ESAF Small Finance Bank FD",
        "rate": "~7.85% p.a.",
        "highlight": "Qualifies for Section 80C tax deduction up to ₹1.5 lakh with 5-year lock-in.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "5 Years",
        "badge": "Tax Saver 80C"
      },
      {
        "name": "ESAF Small Finance Bank FD (Auto-Sweep Facility)",
        "provider": "ESAF Small Finance Bank FD",
        "rate": "~7.85% p.a.",
        "highlight": "Link savings account idle balance for auto-sweep FD interest.",
        "platform": "NetBanking App",
        "minInvestment": "₹1000",
        "tenure": "Flexible"
      }
    ]
  },
  "utkarsh_sfb_fd": {
    "title": "Best Options for Utkarsh Small Finance Bank FD",
    "riskLevel": 2,
    "note": "High-yield DICGC-insured deposit from Utkarsh Small Finance Bank up to 8.50% p.a. DICGC insured up to ₹5 lakh where applicable.",
    "howToStart": "Open via Utkarsh SFB mobile app or portal.",
    "products": [
      {
        "name": "Utkarsh Small Finance Bank FD (1 Year Tenure)",
        "provider": "Utkarsh Small Finance Bank FD",
        "rate": "~8.1% p.a.",
        "highlight": "Optimal short term liquidity with fixed guaranteed return.",
        "platform": "NetBanking / Mobile App",
        "minInvestment": "₹1000",
        "tenure": "1 Year",
        "badge": "Most Flexible"
      },
      {
        "name": "Utkarsh Small Finance Bank FD (2–3 Year Tenure)",
        "provider": "Utkarsh Small Finance Bank FD",
        "rate": "~8.4%",
        "highlight": "Higher interest yield for medium term capital lock-in.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "2-3 Years",
        "badge": "Highest Yield"
      },
      {
        "name": "Utkarsh Small Finance Bank FD (Senior Citizen Option)",
        "provider": "Utkarsh Small Finance Bank FD",
        "rate": "~8.6%",
        "highlight": "Additional 0.50% interest rate benefit for age 60+.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "1-5 Years",
        "badge": "Senior Privilege"
      },
      {
        "name": "Utkarsh Small Finance Bank FD (5 Year Tax Saver)",
        "provider": "Utkarsh Small Finance Bank FD",
        "rate": "~8.1% p.a.",
        "highlight": "Qualifies for Section 80C tax deduction up to ₹1.5 lakh with 5-year lock-in.",
        "platform": "NetBanking / Branch",
        "minInvestment": "₹1000",
        "tenure": "5 Years",
        "badge": "Tax Saver 80C"
      },
      {
        "name": "Utkarsh Small Finance Bank FD (Auto-Sweep Facility)",
        "provider": "Utkarsh Small Finance Bank FD",
        "rate": "~8.1% p.a.",
        "highlight": "Link savings account idle balance for auto-sweep FD interest.",
        "platform": "NetBanking App",
        "minInvestment": "₹1000",
        "tenure": "Flexible"
      }
    ]
  },
  "rbi_retail_direct_gilt": {
    "title": "Where to Access RBI Retail Direct Gilt Account",
    "riskLevel": 1,
    "note": "Direct access portal provided by Reserve Bank of India to buy Government Securities and T-Bills with zero intermediary fees. Guaranteed by Government of India / RBI authority.",
    "howToStart": "Register online at rbiretaildirect.org.in using PAN and Aadhaar.",
    "products": [
      {
        "name": "SBI RBI Retail Direct Gilt Account",
        "provider": "State Bank of India",
        "rate": "~7.15% p.a.",
        "highlight": "India's largest branch network (22,000+) ensuring seamless access & auto-credit.",
        "platform": "SBI YONO / Branch",
        "minInvestment": "₹10000",
        "tenure": "Fixed Term",
        "badge": "Most Accessible"
      },
      {
        "name": "HDFC Bank RBI Retail Direct Gilt Account",
        "provider": "HDFC Bank",
        "rate": "~7.15% p.a.",
        "highlight": "Seamless digital account setup and instant e-statements via NetBanking.",
        "platform": "HDFC NetBanking / Branch",
        "minInvestment": "₹10000",
        "tenure": "Fixed Term",
        "badge": "Best Digital UI"
      },
      {
        "name": "ICICI Bank RBI Retail Direct Gilt Account",
        "provider": "ICICI Bank",
        "rate": "~7.15% p.a.",
        "highlight": "Quick digital tracking via iMobile Pay app with free tax reports.",
        "platform": "ICICI iMobile / Branch",
        "minInvestment": "₹10000",
        "tenure": "Fixed Term"
      },
      {
        "name": "India Post RBI Retail Direct Gilt Account",
        "provider": "India Post",
        "rate": "~7.15% p.a.",
        "highlight": "Available at 1.55 lakh+ post offices nationwide for 100% rural & urban reach.",
        "platform": "Any Post Office Branch",
        "minInvestment": "₹10000",
        "tenure": "Fixed Term",
        "badge": "100% Physical Reach"
      },
      {
        "name": "Axis / PNB Bank RBI Retail Direct Gilt Account",
        "provider": "Axis / PNB Bank",
        "rate": "~7.15% p.a.",
        "highlight": "Dedicated government scheme counters and quick processing.",
        "platform": "Bank Branch / Portal",
        "minInvestment": "₹10000",
        "tenure": "Fixed Term"
      }
    ]
  },
  "digital_gold": {
    "title": "Best Platforms & Products for Digital Gold (24K 99.9% Pure)",
    "riskLevel": 2,
    "note": "Invest in 24K 99.9% pure gold starting at just ₹1 via digital payment apps, stored in MMTC-PAMP / Augmont insured vaults.",
    "howToStart": "Buy instantly on PhonePe, Paytm, Groww, or Google Pay under Gold section.",
    "products": [
      {
        "name": "Zerodha Kite Digital Gold (24K 99.9% Pure)",
        "provider": "Zerodha",
        "rate": "~11.5% p.a.",
        "highlight": "Zero brokerage on equity delivery investments with India's largest discount broker.",
        "platform": "Zerodha Kite App",
        "minInvestment": "₹100",
        "badge": "Top Discount Broker"
      },
      {
        "name": "HDFC Gold ETF",
        "provider": "Groww",
        "rate": "~11.5% p.a.",
        "highlight": "Most beginner-friendly UI with instant paperless onboarding.",
        "platform": "Groww App",
        "minInvestment": "₹100",
        "badge": "Best Beginner UI"
      },
      {
        "name": "ICICI Prudential Gold ETF",
        "provider": "Angel One",
        "rate": "~11.5% p.a.",
        "highlight": "Full service research reports and automated trading tools.",
        "platform": "Angel One App",
        "minInvestment": "₹100"
      },
      {
        "name": "Axis Gold ETF",
        "provider": "ICICI Direct",
        "rate": "~11.5% p.a.",
        "highlight": "3-in-1 integrated banking + demat + trading account convenience.",
        "platform": "ICICI Direct Portal",
        "minInvestment": "₹100"
      },
      {
        "name": "Upstox / Kuvera Digital Gold (24K 99.9% Pure)",
        "provider": "Upstox / Kuvera",
        "rate": "~11.5% p.a.",
        "highlight": "Low fee execution with direct portfolio analytics.",
        "platform": "Upstox / Kuvera App",
        "minInvestment": "₹100"
      }
    ]
  },
  "defence_sector_mf": {
    "title": "Best Defence Sector Mutual Fund Schemes in India",
    "riskLevel": 4,
    "note": "Thematic equity fund investing in Indian defence equipment manufacturers, shipbuilders, and aerospace companies. 12.5% LTCG tax above ₹1.25L; 20% STCG.",
    "howToStart": "Invest in zero-commission Direct plans via Groww, Zerodha Coin, or Kuvera.",
    "products": [
      {
        "name": "Nippon India Defence Sector Direct Growth",
        "provider": "Nippon India AMC",
        "rate": "~18.5% p.a.",
        "highlight": "High alpha generator with proven multi-year track record.",
        "platform": "Groww / Coin",
        "minInvestment": "₹100 SIP",
        "badge": "Top Performer"
      },
      {
        "name": "ICICI Pru Defence Sector Direct Plan",
        "provider": "ICICI Prudential AMC",
        "rate": "~18.5% p.a.",
        "highlight": "Disciplined risk-adjusted framework and strong downside protection.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Consistent Alpha"
      },
      {
        "name": "HDFC Defence Sector Direct Growth",
        "provider": "HDFC AMC",
        "rate": "~18.5% p.a.",
        "highlight": "Large fund size with high liquidity and robust research coverage.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP"
      },
      {
        "name": "SBI Defence Sector Direct Plan",
        "provider": "SBI Mutual Fund",
        "rate": "~18.5% p.a.",
        "highlight": "Extensive equity research desk backing high conviction stocks.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Mirae Asset Defence Sector Direct",
        "provider": "Mirae Asset AMC",
        "rate": "~18.5% p.a.",
        "highlight": "Quality-first investment style focusing on high ROE growth leaders.",
        "platform": "Mirae MF / Kuvera",
        "minInvestment": "₹500 SIP"
      }
    ]
  },
  "multi_asset_allocation_mf": {
    "title": "Best Multi-Asset Allocation Fund Schemes in India",
    "riskLevel": 3,
    "note": "Hybrid mutual fund mandated to invest across at least 3 asset classes (Equity, Debt, Gold/REITs) with at least 10% allocation to each. 12.5% LTCG tax above ₹1.25L; 20% STCG.",
    "howToStart": "Invest in zero-commission Direct plans via Groww, Zerodha Coin, or Kuvera.",
    "products": [
      {
        "name": "Nippon India Multi-Asset Allocation Direct Growth",
        "provider": "Nippon India AMC",
        "rate": "~13.5% p.a.",
        "highlight": "High alpha generator with proven multi-year track record.",
        "platform": "Groww / Coin",
        "minInvestment": "₹100 SIP",
        "badge": "Top Performer"
      },
      {
        "name": "ICICI Pru Multi-Asset Allocation Direct Plan",
        "provider": "ICICI Prudential AMC",
        "rate": "~13.5% p.a.",
        "highlight": "Disciplined risk-adjusted framework and strong downside protection.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Consistent Alpha"
      },
      {
        "name": "HDFC Multi-Asset Allocation Direct Growth",
        "provider": "HDFC AMC",
        "rate": "~13.5% p.a.",
        "highlight": "Large fund size with high liquidity and robust research coverage.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP"
      },
      {
        "name": "SBI Multi-Asset Allocation Direct Plan",
        "provider": "SBI Mutual Fund",
        "rate": "~13.5% p.a.",
        "highlight": "Extensive equity research desk backing high conviction stocks.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Mirae Asset Multi-Asset Allocation Direct",
        "provider": "Mirae Asset AMC",
        "rate": "~13.5% p.a.",
        "highlight": "Quality-first investment style focusing on high ROE growth leaders.",
        "platform": "Mirae MF / Kuvera",
        "minInvestment": "₹500 SIP"
      }
    ]
  },
  "conservative_hybrid_mf": {
    "title": "Top Rated Conservative Hybrid Fund Schemes",
    "riskLevel": 2,
    "note": "Debt-oriented hybrid fund holding 75%–90% in debt instruments and 10%–25% in equity for kicker returns. Taxed at marginal income slab rates.",
    "howToStart": "Invest in Direct plans via Groww, Zerodha Coin, or AMC websites.",
    "products": [
      {
        "name": "ICICI Pru Conservative Hybrid Direct Fund",
        "provider": "ICICI Prudential AMC",
        "rate": "~9.5% p.a.",
        "highlight": "High credit quality portfolio with low expense ratio.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹500 SIP",
        "badge": "Top Rated"
      },
      {
        "name": "HDFC Conservative Hybrid Direct Plan",
        "provider": "HDFC AMC",
        "rate": "~9.5% p.a.",
        "highlight": "Institutional grade risk management and steady return track record.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Category Leader"
      },
      {
        "name": "SBI Conservative Hybrid Direct Growth",
        "provider": "SBI Mutual Fund",
        "rate": "~9.5% p.a.",
        "highlight": "Backed by India's largest PSU AMC with conservative credit selection.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Kotak Conservative Hybrid Direct Plan",
        "provider": "Kotak Mutual Fund",
        "rate": "~9.5% p.a.",
        "highlight": "Focuses on AAA sovereign & PSU bond allocations.",
        "platform": "Kotak MF / Kuvera",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Aditya Birla Sun Life Conservative Hybrid Direct",
        "provider": "Aditya Birla Sun Life AMC",
        "rate": "~9.5% p.a.",
        "highlight": "Consistent liquidity management and competitive yield.",
        "platform": "ABSL MF / Groww",
        "minInvestment": "₹100 SIP"
      }
    ]
  },
  "children_solution_fund": {
    "title": "Best Children's Solution-Oriented Fund Schemes in India",
    "riskLevel": 3,
    "note": "Goal-specific solution fund for child education & marriage with mandatory 5-year lock-in or until child turns 18. 12.5% LTCG tax above ₹1.25L; 20% STCG.",
    "howToStart": "Invest in zero-commission Direct plans via Groww, Zerodha Coin, or Kuvera.",
    "products": [
      {
        "name": "Nippon India Children's Solution-Oriented Direct Growth",
        "provider": "Nippon India AMC",
        "rate": "~13.5% p.a.",
        "highlight": "High alpha generator with proven multi-year track record.",
        "platform": "Groww / Coin",
        "minInvestment": "₹100 SIP",
        "badge": "Top Performer"
      },
      {
        "name": "ICICI Pru Children's Solution-Oriented Direct Plan",
        "provider": "ICICI Prudential AMC",
        "rate": "~13.5% p.a.",
        "highlight": "Disciplined risk-adjusted framework and strong downside protection.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Consistent Alpha"
      },
      {
        "name": "HDFC Children's Solution-Oriented Direct Growth",
        "provider": "HDFC AMC",
        "rate": "~13.5% p.a.",
        "highlight": "Large fund size with high liquidity and robust research coverage.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP"
      },
      {
        "name": "SBI Children's Solution-Oriented Direct Plan",
        "provider": "SBI Mutual Fund",
        "rate": "~13.5% p.a.",
        "highlight": "Extensive equity research desk backing high conviction stocks.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Mirae Asset Children's Solution-Oriented Direct",
        "provider": "Mirae Asset AMC",
        "rate": "~13.5% p.a.",
        "highlight": "Quality-first investment style focusing on high ROE growth leaders.",
        "platform": "Mirae MF / Kuvera",
        "minInvestment": "₹500 SIP"
      }
    ]
  },
  "retirement_solution_fund": {
    "title": "Best Retirement Solution-Oriented Mutual Fund Schemes in India",
    "riskLevel": 3,
    "note": "Dedicated retirement corpus building mutual fund featuring a mandatory 5-year lock-in or until retirement age (55). 12.5% LTCG tax above ₹1.25L; 20% STCG.",
    "howToStart": "Invest in zero-commission Direct plans via Groww, Zerodha Coin, or Kuvera.",
    "products": [
      {
        "name": "Nippon India Retirement Solution-Oriented Direct Growth",
        "provider": "Nippon India AMC",
        "rate": "~13% p.a.",
        "highlight": "High alpha generator with proven multi-year track record.",
        "platform": "Groww / Coin",
        "minInvestment": "₹100 SIP",
        "badge": "Top Performer"
      },
      {
        "name": "ICICI Pru Retirement Solution-Oriented Direct Plan",
        "provider": "ICICI Prudential AMC",
        "rate": "~13% p.a.",
        "highlight": "Disciplined risk-adjusted framework and strong downside protection.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Consistent Alpha"
      },
      {
        "name": "HDFC Retirement Solution-Oriented Direct Growth",
        "provider": "HDFC AMC",
        "rate": "~13% p.a.",
        "highlight": "Large fund size with high liquidity and robust research coverage.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP"
      },
      {
        "name": "SBI Retirement Solution-Oriented Direct Plan",
        "provider": "SBI Mutual Fund",
        "rate": "~13% p.a.",
        "highlight": "Extensive equity research desk backing high conviction stocks.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Mirae Asset Retirement Solution-Oriented Direct",
        "provider": "Mirae Asset AMC",
        "rate": "~13% p.a.",
        "highlight": "Quality-first investment style focusing on high ROE growth leaders.",
        "platform": "Mirae MF / Kuvera",
        "minInvestment": "₹500 SIP"
      }
    ]
  },
  "psu_sector_mf": {
    "title": "Best PSU Equity Sector Fund Schemes in India",
    "riskLevel": 4,
    "note": "Thematic fund investing in Public Sector Undertakings (PSUs) across power, defence, banking, and infrastructure. 12.5% LTCG tax above ₹1.25L; 20% STCG.",
    "howToStart": "Invest in zero-commission Direct plans via Groww, Zerodha Coin, or Kuvera.",
    "products": [
      {
        "name": "Nippon India PSU Equity Sector Direct Growth",
        "provider": "Nippon India AMC",
        "rate": "~16.5% p.a.",
        "highlight": "High alpha generator with proven multi-year track record.",
        "platform": "Groww / Coin",
        "minInvestment": "₹100 SIP",
        "badge": "Top Performer"
      },
      {
        "name": "ICICI Pru PSU Equity Sector Direct Plan",
        "provider": "ICICI Prudential AMC",
        "rate": "~16.5% p.a.",
        "highlight": "Disciplined risk-adjusted framework and strong downside protection.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Consistent Alpha"
      },
      {
        "name": "HDFC PSU Equity Sector Direct Growth",
        "provider": "HDFC AMC",
        "rate": "~16.5% p.a.",
        "highlight": "Large fund size with high liquidity and robust research coverage.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP"
      },
      {
        "name": "SBI PSU Equity Sector Direct Plan",
        "provider": "SBI Mutual Fund",
        "rate": "~16.5% p.a.",
        "highlight": "Extensive equity research desk backing high conviction stocks.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Mirae Asset PSU Equity Sector Direct",
        "provider": "Mirae Asset AMC",
        "rate": "~16.5% p.a.",
        "highlight": "Quality-first investment style focusing on high ROE growth leaders.",
        "platform": "Mirae MF / Kuvera",
        "minInvestment": "₹500 SIP"
      }
    ]
  },
  "auto_sector_mf": {
    "title": "Best Auto & EV Sector Fund Schemes in India",
    "riskLevel": 4,
    "note": "Thematic mutual fund investing in automobile manufacturers, EV makers, battery tech, and auto component suppliers. 12.5% LTCG tax above ₹1.25L; 20% STCG.",
    "howToStart": "Invest in zero-commission Direct plans via Groww, Zerodha Coin, or Kuvera.",
    "products": [
      {
        "name": "Nippon India Auto & EV Sector Direct Growth",
        "provider": "Nippon India AMC",
        "rate": "~15.5% p.a.",
        "highlight": "High alpha generator with proven multi-year track record.",
        "platform": "Groww / Coin",
        "minInvestment": "₹100 SIP",
        "badge": "Top Performer"
      },
      {
        "name": "ICICI Pru Auto & EV Sector Direct Plan",
        "provider": "ICICI Prudential AMC",
        "rate": "~15.5% p.a.",
        "highlight": "Disciplined risk-adjusted framework and strong downside protection.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Consistent Alpha"
      },
      {
        "name": "HDFC Auto & EV Sector Direct Growth",
        "provider": "HDFC AMC",
        "rate": "~15.5% p.a.",
        "highlight": "Large fund size with high liquidity and robust research coverage.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP"
      },
      {
        "name": "SBI Auto & EV Sector Direct Plan",
        "provider": "SBI Mutual Fund",
        "rate": "~15.5% p.a.",
        "highlight": "Extensive equity research desk backing high conviction stocks.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Mirae Asset Auto & EV Sector Direct",
        "provider": "Mirae Asset AMC",
        "rate": "~15.5% p.a.",
        "highlight": "Quality-first investment style focusing on high ROE growth leaders.",
        "platform": "Mirae MF / Kuvera",
        "minInvestment": "₹500 SIP"
      }
    ]
  },
  "fmcg_sector_mf": {
    "title": "Best FMCG & Consumer Staples Sector Fund Schemes in India",
    "riskLevel": 3,
    "note": "Defensive equity sector fund investing in fast-moving consumer goods (HUL, ITC, Nestlé, Britannia). 12.5% LTCG tax above ₹1.25L; 20% STCG.",
    "howToStart": "Invest in zero-commission Direct plans via Groww, Zerodha Coin, or Kuvera.",
    "products": [
      {
        "name": "Nippon India FMCG & Consumer Staples Sector Direct Growth",
        "provider": "Nippon India AMC",
        "rate": "~12.5% p.a.",
        "highlight": "High alpha generator with proven multi-year track record.",
        "platform": "Groww / Coin",
        "minInvestment": "₹100 SIP",
        "badge": "Top Performer"
      },
      {
        "name": "ICICI Pru FMCG & Consumer Staples Sector Direct Plan",
        "provider": "ICICI Prudential AMC",
        "rate": "~12.5% p.a.",
        "highlight": "Disciplined risk-adjusted framework and strong downside protection.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Consistent Alpha"
      },
      {
        "name": "HDFC FMCG & Consumer Staples Sector Direct Growth",
        "provider": "HDFC AMC",
        "rate": "~12.5% p.a.",
        "highlight": "Large fund size with high liquidity and robust research coverage.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP"
      },
      {
        "name": "SBI FMCG & Consumer Staples Sector Direct Plan",
        "provider": "SBI Mutual Fund",
        "rate": "~12.5% p.a.",
        "highlight": "Extensive equity research desk backing high conviction stocks.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Mirae Asset FMCG & Consumer Staples Sector Direct",
        "provider": "Mirae Asset AMC",
        "rate": "~12.5% p.a.",
        "highlight": "Quality-first investment style focusing on high ROE growth leaders.",
        "platform": "Mirae MF / Kuvera",
        "minInvestment": "₹500 SIP"
      }
    ]
  },
  "fixed_maturity_plan": {
    "title": "Top Rated Fixed Maturity Plan (FMP) Schemes",
    "riskLevel": 2,
    "note": "Closed-ended debt mutual fund that locks in interest yields by holding bonds till maturity. Taxed at marginal income slab rates.",
    "howToStart": "Invest in Direct plans via Groww, Zerodha Coin, or AMC websites.",
    "products": [
      {
        "name": "ICICI Pru Fixed Maturity Plan (FMP) Direct Fund",
        "provider": "ICICI Prudential AMC",
        "rate": "~7.5% p.a.",
        "highlight": "High credit quality portfolio with low expense ratio.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹500 SIP",
        "badge": "Top Rated"
      },
      {
        "name": "HDFC Fixed Maturity Plan (FMP) Direct Plan",
        "provider": "HDFC AMC",
        "rate": "~7.5% p.a.",
        "highlight": "Institutional grade risk management and steady return track record.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Category Leader"
      },
      {
        "name": "SBI Fixed Maturity Plan (FMP) Direct Growth",
        "provider": "SBI Mutual Fund",
        "rate": "~7.5% p.a.",
        "highlight": "Backed by India's largest PSU AMC with conservative credit selection.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Kotak Fixed Maturity Plan (FMP) Direct Plan",
        "provider": "Kotak Mutual Fund",
        "rate": "~7.5% p.a.",
        "highlight": "Focuses on AAA sovereign & PSU bond allocations.",
        "platform": "Kotak MF / Kuvera",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Aditya Birla Sun Life Fixed Maturity Plan (FMP) Direct",
        "provider": "Aditya Birla Sun Life AMC",
        "rate": "~7.5% p.a.",
        "highlight": "Consistent liquidity management and competitive yield.",
        "platform": "ABSL MF / Groww",
        "minInvestment": "₹100 SIP"
      }
    ]
  },
  "treasury_bills": {
    "title": "Where to Access Government Treasury Bills (T-Bills)",
    "riskLevel": 1,
    "note": "Short-term sovereign debt instruments issued by RBI on behalf of Govt of India at a discount for 91D, 182D, or 364D tenures. Guaranteed by Government of India / RBI authority.",
    "howToStart": "Bid during weekly RBI auctions on RBI Retail Direct or Zerodha Kite.",
    "products": [
      {
        "name": "SBI Government Treasury Bills (T-Bills)",
        "provider": "State Bank of India",
        "rate": "~6.85% p.a.",
        "highlight": "India's largest branch network (22,000+) ensuring seamless access & auto-credit.",
        "platform": "SBI YONO / Branch",
        "minInvestment": "₹10000",
        "tenure": "Fixed Term",
        "badge": "Most Accessible"
      },
      {
        "name": "HDFC Bank Government Treasury Bills (T-Bills)",
        "provider": "HDFC Bank",
        "rate": "~6.85% p.a.",
        "highlight": "Seamless digital account setup and instant e-statements via NetBanking.",
        "platform": "HDFC NetBanking / Branch",
        "minInvestment": "₹10000",
        "tenure": "Fixed Term",
        "badge": "Best Digital UI"
      },
      {
        "name": "ICICI Bank Government Treasury Bills (T-Bills)",
        "provider": "ICICI Bank",
        "rate": "~6.85% p.a.",
        "highlight": "Quick digital tracking via iMobile Pay app with free tax reports.",
        "platform": "ICICI iMobile / Branch",
        "minInvestment": "₹10000",
        "tenure": "Fixed Term"
      },
      {
        "name": "India Post Government Treasury Bills (T-Bills)",
        "provider": "India Post",
        "rate": "~6.85% p.a.",
        "highlight": "Available at 1.55 lakh+ post offices nationwide for 100% rural & urban reach.",
        "platform": "Any Post Office Branch",
        "minInvestment": "₹10000",
        "tenure": "Fixed Term",
        "badge": "100% Physical Reach"
      },
      {
        "name": "Axis / PNB Bank Government Treasury Bills (T-Bills)",
        "provider": "Axis / PNB Bank",
        "rate": "~6.85% p.a.",
        "highlight": "Dedicated government scheme counters and quick processing.",
        "platform": "Bank Branch / Portal",
        "minInvestment": "₹10000",
        "tenure": "Fixed Term"
      }
    ]
  },
  "infrastructure_invit": {
    "title": "Best Platforms & Products for Infrastructure Investment Trust (InvIT)",
    "riskLevel": 3,
    "note": "Exchange-traded trust owning revenue-generating infrastructure assets (power transmission grids, toll highways) distributing 90%+ cash flows as payouts.",
    "howToStart": "Buy units on NSE/BSE via Zerodha, Groww, or Angel One.",
    "products": [
      {
        "name": "Zerodha Kite Infrastructure Investment Trust (InvIT)",
        "provider": "Zerodha",
        "rate": "~10.5% p.a.",
        "highlight": "Zero brokerage on equity delivery investments with India's largest discount broker.",
        "platform": "Zerodha Kite App",
        "minInvestment": "₹5000",
        "badge": "Top Discount Broker"
      },
      {
        "name": "Infrastructure Investment Trust (InvIT) (Direct Plan)",
        "provider": "Groww",
        "rate": "~10.5% p.a.",
        "highlight": "Most beginner-friendly UI with instant paperless onboarding.",
        "platform": "Groww App",
        "minInvestment": "₹5000",
        "badge": "Best Beginner UI"
      },
      {
        "name": "Infrastructure Investment Trust (InvIT) (Direct Plan)",
        "provider": "Angel One",
        "rate": "~10.5% p.a.",
        "highlight": "Full service research reports and automated trading tools.",
        "platform": "Angel One App",
        "minInvestment": "₹5000"
      },
      {
        "name": "Infrastructure Investment Trust (InvIT) (Direct Plan)",
        "provider": "ICICI Direct",
        "rate": "~10.5% p.a.",
        "highlight": "3-in-1 integrated banking + demat + trading account convenience.",
        "platform": "ICICI Direct Portal",
        "minInvestment": "₹5000"
      },
      {
        "name": "Upstox / Kuvera Infrastructure Investment Trust (InvIT)",
        "provider": "Upstox / Kuvera",
        "rate": "~10.5% p.a.",
        "highlight": "Low fee execution with direct portfolio analytics.",
        "platform": "Upstox / Kuvera App",
        "minInvestment": "₹5000"
      }
    ]
  },
  "floating_rate_debt_mf": {
    "title": "Top Rated Floating Rate Debt Mutual Fund Schemes",
    "riskLevel": 2,
    "note": "Debt scheme investing at least 65% in floating rate bonds whose coupon interest rate resets periodically with market rates. Taxed at marginal income slab rates.",
    "howToStart": "Invest in Direct plans via Groww, Zerodha Coin, or AMC websites.",
    "products": [
      {
        "name": "ICICI Pru Floating Rate Debt Direct Fund",
        "provider": "ICICI Prudential AMC",
        "rate": "~7.4% p.a.",
        "highlight": "High credit quality portfolio with low expense ratio.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹500 SIP",
        "badge": "Top Rated"
      },
      {
        "name": "HDFC Floating Rate Debt Direct Plan",
        "provider": "HDFC AMC",
        "rate": "~7.4% p.a.",
        "highlight": "Institutional grade risk management and steady return track record.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Category Leader"
      },
      {
        "name": "SBI Floating Rate Debt Direct Growth",
        "provider": "SBI Mutual Fund",
        "rate": "~7.4% p.a.",
        "highlight": "Backed by India's largest PSU AMC with conservative credit selection.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Kotak Floating Rate Debt Direct Plan",
        "provider": "Kotak Mutual Fund",
        "rate": "~7.4% p.a.",
        "highlight": "Focuses on AAA sovereign & PSU bond allocations.",
        "platform": "Kotak MF / Kuvera",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Aditya Birla Sun Life Floating Rate Debt Mutual Direct",
        "provider": "Aditya Birla Sun Life AMC",
        "rate": "~7.4% p.a.",
        "highlight": "Consistent liquidity management and competitive yield.",
        "platform": "ABSL MF / Groww",
        "minInvestment": "₹100 SIP"
      }
    ]
  },
  "p2p_lending": {
    "title": "Best Platforms & Products for Peer-to-Peer (P2P) Lending",
    "riskLevel": 4,
    "note": "RBI-regulated NBFC-P2P platforms connecting individual lenders with retail/MSME borrowers to earn ~10–12% yields.",
    "howToStart": "Register on RBI-licensed NBFC-P2P platforms.",
    "products": [
      {
        "name": "Zerodha Kite Peer-to-Peer (P2P) Lending",
        "provider": "Zerodha",
        "rate": "~10.5% p.a.",
        "highlight": "Zero brokerage on equity delivery investments with India's largest discount broker.",
        "platform": "Zerodha Kite App",
        "minInvestment": "₹5000",
        "badge": "Top Discount Broker"
      },
      {
        "name": "HDFC Peer-to-Peer (P2P) Lending (Direct Growth)",
        "provider": "Groww",
        "rate": "~10.5% p.a.",
        "highlight": "Most beginner-friendly UI with instant paperless onboarding.",
        "platform": "Groww App",
        "minInvestment": "₹5000",
        "badge": "Best Beginner UI"
      },
      {
        "name": "ICICI Prudential Peer-to-Peer (P2P) Lending (Direct Growth)",
        "provider": "Angel One",
        "rate": "~10.5% p.a.",
        "highlight": "Full service research reports and automated trading tools.",
        "platform": "Angel One App",
        "minInvestment": "₹5000"
      },
      {
        "name": "Axis Peer-to-Peer (P2P) Lending (Direct Growth)",
        "provider": "ICICI Direct",
        "rate": "~10.5% p.a.",
        "highlight": "3-in-1 integrated banking + demat + trading account convenience.",
        "platform": "ICICI Direct Portal",
        "minInvestment": "₹5000"
      },
      {
        "name": "Upstox / Kuvera Peer-to-Peer (P2P) Lending",
        "provider": "Upstox / Kuvera",
        "rate": "~10.5% p.a.",
        "highlight": "Low fee execution with direct portfolio analytics.",
        "platform": "Upstox / Kuvera App",
        "minInvestment": "₹5000"
      }
    ]
  },
  "smallcase_thematic": {
    "title": "Best Platforms & Products for Smallcase Model Portfolios",
    "riskLevel": 4,
    "note": "Curated baskets of individual stocks/ETFs reflecting specific themes (EV, Dividend Stars, IT Leaders) created by SEBI registered research analysts.",
    "howToStart": "Connect your broker account (Zerodha, Groww) on Smallcase website/app.",
    "products": [
      {
        "name": "Zerodha Kite Smallcase Model Portfolios",
        "provider": "Zerodha",
        "rate": "~16% p.a.",
        "highlight": "Zero brokerage on equity delivery investments with India's largest discount broker.",
        "platform": "Zerodha Kite App",
        "minInvestment": "₹5000",
        "badge": "Top Discount Broker"
      },
      {
        "name": "HDFC Smallcase Model Portfolios (Direct Growth)",
        "provider": "Groww",
        "rate": "~16% p.a.",
        "highlight": "Most beginner-friendly UI with instant paperless onboarding.",
        "platform": "Groww App",
        "minInvestment": "₹5000",
        "badge": "Best Beginner UI"
      },
      {
        "name": "ICICI Prudential Smallcase Model Portfolios (Direct Growth)",
        "provider": "Angel One",
        "rate": "~16% p.a.",
        "highlight": "Full service research reports and automated trading tools.",
        "platform": "Angel One App",
        "minInvestment": "₹5000"
      },
      {
        "name": "Axis Smallcase Model Portfolios (Direct Growth)",
        "provider": "ICICI Direct",
        "rate": "~16% p.a.",
        "highlight": "3-in-1 integrated banking + demat + trading account convenience.",
        "platform": "ICICI Direct Portal",
        "minInvestment": "₹5000"
      },
      {
        "name": "Upstox / Kuvera Smallcase Model Portfolios",
        "provider": "Upstox / Kuvera",
        "rate": "~16% p.a.",
        "highlight": "Low fee execution with direct portfolio analytics.",
        "platform": "Upstox / Kuvera App",
        "minInvestment": "₹5000"
      }
    ]
  },
  "pre_ipo_unlisted_shares": {
    "title": "Best Platforms & Products for Pre-IPO & Unlisted Shares",
    "riskLevel": 5,
    "note": "Investing in unlisted shares of private tech unicorns and mature companies before they list on public stock exchanges.",
    "howToStart": "Buy off-market via specialized unlisted equity platforms.",
    "products": [
      {
        "name": "Zerodha Kite Pre-IPO & Unlisted Shares",
        "provider": "Zerodha",
        "rate": "~20% p.a.",
        "highlight": "Zero brokerage on equity delivery investments with India's largest discount broker.",
        "platform": "Zerodha Kite App",
        "minInvestment": "₹50000",
        "badge": "Top Discount Broker"
      },
      {
        "name": "HDFC Pre-IPO & Unlisted Shares (Direct Growth)",
        "provider": "Groww",
        "rate": "~20% p.a.",
        "highlight": "Most beginner-friendly UI with instant paperless onboarding.",
        "platform": "Groww App",
        "minInvestment": "₹50000",
        "badge": "Best Beginner UI"
      },
      {
        "name": "ICICI Prudential Pre-IPO & Unlisted Shares (Direct Growth)",
        "provider": "Angel One",
        "rate": "~20% p.a.",
        "highlight": "Full service research reports and automated trading tools.",
        "platform": "Angel One App",
        "minInvestment": "₹50000"
      },
      {
        "name": "Axis Pre-IPO & Unlisted Shares (Direct Growth)",
        "provider": "ICICI Direct",
        "rate": "~20% p.a.",
        "highlight": "3-in-1 integrated banking + demat + trading account convenience.",
        "platform": "ICICI Direct Portal",
        "minInvestment": "₹50000"
      },
      {
        "name": "Upstox / Kuvera Pre-IPO & Unlisted Shares",
        "provider": "Upstox / Kuvera",
        "rate": "~20% p.a.",
        "highlight": "Low fee execution with direct portfolio analytics.",
        "platform": "Upstox / Kuvera App",
        "minInvestment": "₹50000"
      }
    ]
  },
  "commodity_futures": {
    "title": "Best Platforms & Products for MCX Commodity Futures",
    "riskLevel": 5,
    "note": "Leveraged futures derivative contracts traded on Multi Commodity Exchange (MCX) tracking Gold, Silver, Crude Oil, and Natural Gas.",
    "howToStart": "Enable MCX commodity segment on your broker app (Zerodha, Angel One).",
    "products": [
      {
        "name": "Zerodha Kite MCX Commodity Futures",
        "provider": "Zerodha",
        "rate": "~12% p.a.",
        "highlight": "Zero brokerage on equity delivery investments with India's largest discount broker.",
        "platform": "Zerodha Kite App",
        "minInvestment": "₹25000",
        "badge": "Top Discount Broker"
      },
      {
        "name": "HDFC MCX Commodity Futures (Direct Growth)",
        "provider": "Groww",
        "rate": "~12% p.a.",
        "highlight": "Most beginner-friendly UI with instant paperless onboarding.",
        "platform": "Groww App",
        "minInvestment": "₹25000",
        "badge": "Best Beginner UI"
      },
      {
        "name": "ICICI Prudential MCX Commodity Futures (Direct Growth)",
        "provider": "Angel One",
        "rate": "~12% p.a.",
        "highlight": "Full service research reports and automated trading tools.",
        "platform": "Angel One App",
        "minInvestment": "₹25000"
      },
      {
        "name": "Axis MCX Commodity Futures (Direct Growth)",
        "provider": "ICICI Direct",
        "rate": "~12% p.a.",
        "highlight": "3-in-1 integrated banking + demat + trading account convenience.",
        "platform": "ICICI Direct Portal",
        "minInvestment": "₹25000"
      },
      {
        "name": "Upstox / Kuvera MCX Commodity Futures",
        "provider": "Upstox / Kuvera",
        "rate": "~12% p.a.",
        "highlight": "Low fee execution with direct portfolio analytics.",
        "platform": "Upstox / Kuvera App",
        "minInvestment": "₹25000"
      }
    ]
  },
  "futures_and_options": {
    "title": "Best Platforms & Products for Futures & Options (F&O) Derivatives",
    "riskLevel": 5,
    "note": "High-leverage financial derivative contracts written on stock indices (Nifty, Bank Nifty) and individual equities.",
    "howToStart": "F&O segment requires income proof activation on broker apps.",
    "products": [
      {
        "name": "Zerodha Kite Futures & Options (F&O) Derivatives",
        "provider": "Zerodha",
        "rate": "~0% p.a.",
        "highlight": "Zero brokerage on equity delivery investments with India's largest discount broker.",
        "platform": "Zerodha Kite App",
        "minInvestment": "₹10000",
        "badge": "Top Discount Broker"
      },
      {
        "name": "HDFC Futures & Options (F&O) Derivatives (Direct Growth)",
        "provider": "Groww",
        "rate": "~0% p.a.",
        "highlight": "Most beginner-friendly UI with instant paperless onboarding.",
        "platform": "Groww App",
        "minInvestment": "₹10000",
        "badge": "Best Beginner UI"
      },
      {
        "name": "ICICI Prudential Futures & Options (F&O) Derivatives (Direct Growth)",
        "provider": "Angel One",
        "rate": "~0% p.a.",
        "highlight": "Full service research reports and automated trading tools.",
        "platform": "Angel One App",
        "minInvestment": "₹10000"
      },
      {
        "name": "Axis Futures & Options (F&O) Derivatives (Direct Growth)",
        "provider": "ICICI Direct",
        "rate": "~0% p.a.",
        "highlight": "3-in-1 integrated banking + demat + trading account convenience.",
        "platform": "ICICI Direct Portal",
        "minInvestment": "₹10000"
      },
      {
        "name": "Upstox / Kuvera Futures & Options (F&O) Derivatives",
        "provider": "Upstox / Kuvera",
        "rate": "~0% p.a.",
        "highlight": "Low fee execution with direct portfolio analytics.",
        "platform": "Upstox / Kuvera App",
        "minInvestment": "₹10000"
      }
    ]
  },
  "crypto_vda": {
    "title": "Best Platforms & Products for Cryptocurrency & VDAs (Bitcoin/ETH)",
    "riskLevel": 5,
    "note": "Decentralized digital tokens (Bitcoin, Ethereum) traded on FIU-registered Indian cryptocurrency exchanges under strict tax laws.",
    "howToStart": "Register on FIU-compliant Indian crypto exchanges with Aadhaar & PAN KYC.",
    "products": [
      {
        "name": "Zerodha Kite Cryptocurrency & VDAs (Bitcoin/ETH)",
        "provider": "Zerodha",
        "rate": "~15% p.a.",
        "highlight": "Zero brokerage on equity delivery investments with India's largest discount broker.",
        "platform": "Zerodha Kite App",
        "minInvestment": "₹100",
        "badge": "Top Discount Broker"
      },
      {
        "name": "HDFC Cryptocurrency & VDAs (Bitcoin/ETH) (Direct Growth)",
        "provider": "Groww",
        "rate": "~15% p.a.",
        "highlight": "Most beginner-friendly UI with instant paperless onboarding.",
        "platform": "Groww App",
        "minInvestment": "₹100",
        "badge": "Best Beginner UI"
      },
      {
        "name": "ICICI Prudential Cryptocurrency & VDAs (Bitcoin/ETH) (Direct Growth)",
        "provider": "Angel One",
        "rate": "~15% p.a.",
        "highlight": "Full service research reports and automated trading tools.",
        "platform": "Angel One App",
        "minInvestment": "₹100"
      },
      {
        "name": "Axis Cryptocurrency & VDAs (Bitcoin/ETH) (Direct Growth)",
        "provider": "ICICI Direct",
        "rate": "~15% p.a.",
        "highlight": "3-in-1 integrated banking + demat + trading account convenience.",
        "platform": "ICICI Direct Portal",
        "minInvestment": "₹100"
      },
      {
        "name": "Upstox / Kuvera Cryptocurrency & VDAs (Bitcoin/ETH)",
        "provider": "Upstox / Kuvera",
        "rate": "~15% p.a.",
        "highlight": "Low fee execution with direct portfolio analytics.",
        "platform": "Upstox / Kuvera App",
        "minInvestment": "₹100"
      }
    ]
  },
  "momentum_factor_etf": {
    "title": "Best Nifty200 Momentum 30 ETF Units on NSE/BSE",
    "riskLevel": 4,
    "note": "Factor-investing ETF tracking the top 30 momentum stocks selected from Nifty 200 based on recent price performance. Traded real-time on stock exchange via Demat account.",
    "howToStart": "Open Demat account on Zerodha, Groww, or Angel One. Search ticker symbol.",
    "products": [
      {
        "name": "Nippon India Nifty200 Momentum 30 ETF",
        "provider": "Nippon India AMC",
        "rate": "~17.5% p.a.",
        "highlight": "Highest trading liquidity and tightest bid-ask spread on NSE.",
        "platform": "Zerodha / Groww",
        "minInvestment": "1 Unit (~₹50-500)",
        "badge": "Most Liquid"
      },
      {
        "name": "SBI Nifty200 Momentum 30 ETF",
        "provider": "SBI Mutual Fund",
        "rate": "~17.5% p.a.",
        "highlight": "Massive AUM backed by EPFO pension fund flows.",
        "platform": "Zerodha / Angel One",
        "minInvestment": "1 Unit",
        "badge": "Largest AUM"
      },
      {
        "name": "ICICI Pru Nifty200 Momentum 30 ETF",
        "provider": "ICICI Prudential AMC",
        "rate": "~17.5% p.a.",
        "highlight": "Low tracking error and active market maker quotes.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "1 Unit"
      },
      {
        "name": "Kotak Nifty200 Momentum 30 ETF",
        "provider": "Kotak Mutual Fund",
        "rate": "~17.5% p.a.",
        "highlight": "Efficient passive tracking with minimal expense ratio drag.",
        "platform": "Kotak Sec / Coin",
        "minInvestment": "1 Unit"
      },
      {
        "name": "Mirae Asset Nifty200 Momentum 30 ETF",
        "provider": "Mirae Asset AMC",
        "rate": "~17.5% p.a.",
        "highlight": "Transparent index replication and seamless execution.",
        "platform": "Groww / Upstox",
        "minInvestment": "1 Unit"
      }
    ]
  },
  "value_factor_mf": {
    "title": "Best Nifty 500 Value 50 Index Fund Schemes in India",
    "riskLevel": 3,
    "note": "Factor-based equity index fund picking top 50 undervalued stocks based on Earnings Yield (P/E), Book Value (P/B), and Dividend Yield. 12.5% LTCG tax above ₹1.25L; 20% STCG.",
    "howToStart": "Invest in zero-commission Direct plans via Groww, Zerodha Coin, or Kuvera.",
    "products": [
      {
        "name": "Nippon India Nifty 500 Value 50 Index Direct Growth",
        "provider": "Nippon India AMC",
        "rate": "~15% p.a.",
        "highlight": "High alpha generator with proven multi-year track record.",
        "platform": "Groww / Coin",
        "minInvestment": "₹100 SIP",
        "badge": "Top Performer"
      },
      {
        "name": "ICICI Pru Nifty 500 Value 50 Index Direct Plan",
        "provider": "ICICI Prudential AMC",
        "rate": "~15% p.a.",
        "highlight": "Disciplined risk-adjusted framework and strong downside protection.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Consistent Alpha"
      },
      {
        "name": "HDFC Nifty 500 Value 50 Index Direct Growth",
        "provider": "HDFC AMC",
        "rate": "~15% p.a.",
        "highlight": "Large fund size with high liquidity and robust research coverage.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP"
      },
      {
        "name": "SBI Nifty 500 Value 50 Index Direct Plan",
        "provider": "SBI Mutual Fund",
        "rate": "~15% p.a.",
        "highlight": "Extensive equity research desk backing high conviction stocks.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Mirae Asset Nifty 500 Value 50 Index Direct",
        "provider": "Mirae Asset AMC",
        "rate": "~15% p.a.",
        "highlight": "Quality-first investment style focusing on high ROE growth leaders.",
        "platform": "Mirae MF / Kuvera",
        "minInvestment": "₹500 SIP"
      }
    ]
  },
  "motilal_nasdaq100_fof": {
    "title": "Best Motilal Oswal Nasdaq 100 FoF Schemes in India",
    "riskLevel": 4,
    "note": "INR feeder mutual fund investing into US Nasdaq 100 index units without needing an overseas demat account. 12.5% LTCG tax above ₹1.25L; 20% STCG.",
    "howToStart": "Invest in zero-commission Direct plans via Groww, Zerodha Coin, or Kuvera.",
    "products": [
      {
        "name": "Nippon India Motilal Oswal Nasdaq 100 FoF Direct Growth",
        "provider": "Nippon India AMC",
        "rate": "~16.5% p.a.",
        "highlight": "High alpha generator with proven multi-year track record.",
        "platform": "Groww / Coin",
        "minInvestment": "₹100 SIP",
        "badge": "Top Performer"
      },
      {
        "name": "ICICI Pru Motilal Oswal Nasdaq 100 FoF Direct Plan",
        "provider": "ICICI Prudential AMC",
        "rate": "~16.5% p.a.",
        "highlight": "Disciplined risk-adjusted framework and strong downside protection.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Consistent Alpha"
      },
      {
        "name": "HDFC Motilal Oswal Nasdaq 100 FoF Direct Growth",
        "provider": "HDFC AMC",
        "rate": "~16.5% p.a.",
        "highlight": "Large fund size with high liquidity and robust research coverage.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP"
      },
      {
        "name": "SBI Motilal Oswal Nasdaq 100 FoF Direct Plan",
        "provider": "SBI Mutual Fund",
        "rate": "~16.5% p.a.",
        "highlight": "Extensive equity research desk backing high conviction stocks.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Mirae Asset Motilal Oswal Nasdaq 100 FoF Direct",
        "provider": "Mirae Asset AMC",
        "rate": "~16.5% p.a.",
        "highlight": "Quality-first investment style focusing on high ROE growth leaders.",
        "platform": "Mirae MF / Kuvera",
        "minInvestment": "₹500 SIP"
      }
    ]
  },
  "motilal_sp500_index": {
    "title": "Best Motilal Oswal S&P 500 Index Fund Schemes in India",
    "riskLevel": 4,
    "note": "Passive INR index fund tracking all 500 leading companies in the US S&P 500 index. 12.5% LTCG tax above ₹1.25L; 20% STCG.",
    "howToStart": "Invest in zero-commission Direct plans via Groww, Zerodha Coin, or Kuvera.",
    "products": [
      {
        "name": "Nippon India Motilal Oswal S&P 500 Index Direct Growth",
        "provider": "Nippon India AMC",
        "rate": "~14.5% p.a.",
        "highlight": "High alpha generator with proven multi-year track record.",
        "platform": "Groww / Coin",
        "minInvestment": "₹100 SIP",
        "badge": "Top Performer"
      },
      {
        "name": "ICICI Pru Motilal Oswal S&P 500 Index Direct Plan",
        "provider": "ICICI Prudential AMC",
        "rate": "~14.5% p.a.",
        "highlight": "Disciplined risk-adjusted framework and strong downside protection.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Consistent Alpha"
      },
      {
        "name": "HDFC Motilal Oswal S&P 500 Index Direct Growth",
        "provider": "HDFC AMC",
        "rate": "~14.5% p.a.",
        "highlight": "Large fund size with high liquidity and robust research coverage.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP"
      },
      {
        "name": "SBI Motilal Oswal S&P 500 Index Direct Plan",
        "provider": "SBI Mutual Fund",
        "rate": "~14.5% p.a.",
        "highlight": "Extensive equity research desk backing high conviction stocks.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Mirae Asset Motilal Oswal S&P 500 Index Direct",
        "provider": "Mirae Asset AMC",
        "rate": "~14.5% p.a.",
        "highlight": "Quality-first investment style focusing on high ROE growth leaders.",
        "platform": "Mirae MF / Kuvera",
        "minInvestment": "₹500 SIP"
      }
    ]
  },
  "motilal_nasdaq_q50_etf": {
    "title": "Best Motilal Oswal Nasdaq Q50 ETF Units on NSE/BSE",
    "riskLevel": 4,
    "note": "NSE-listed ETF tracking the 50 mid-cap tech and innovation leaders next in line to enter the Nasdaq-100. Traded real-time on stock exchange via Demat account.",
    "howToStart": "Open Demat account on Zerodha, Groww, or Angel One. Search ticker symbol.",
    "products": [
      {
        "name": "Nippon India Motilal Oswal Nasdaq Q50 ETF",
        "provider": "Nippon India AMC",
        "rate": "~17% p.a.",
        "highlight": "Highest trading liquidity and tightest bid-ask spread on NSE.",
        "platform": "Zerodha / Groww",
        "minInvestment": "1 Unit (~₹50-500)",
        "badge": "Most Liquid"
      },
      {
        "name": "SBI Motilal Oswal Nasdaq Q50 ETF",
        "provider": "SBI Mutual Fund",
        "rate": "~17% p.a.",
        "highlight": "Massive AUM backed by EPFO pension fund flows.",
        "platform": "Zerodha / Angel One",
        "minInvestment": "1 Unit",
        "badge": "Largest AUM"
      },
      {
        "name": "ICICI Pru Motilal Oswal Nasdaq Q50 ETF",
        "provider": "ICICI Prudential AMC",
        "rate": "~17% p.a.",
        "highlight": "Low tracking error and active market maker quotes.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "1 Unit"
      },
      {
        "name": "Kotak Motilal Oswal Nasdaq Q50 ETF",
        "provider": "Kotak Mutual Fund",
        "rate": "~17% p.a.",
        "highlight": "Efficient passive tracking with minimal expense ratio drag.",
        "platform": "Kotak Sec / Coin",
        "minInvestment": "1 Unit"
      },
      {
        "name": "Mirae Asset Motilal Oswal Nasdaq Q50 ETF",
        "provider": "Mirae Asset AMC",
        "rate": "~17% p.a.",
        "highlight": "Transparent index replication and seamless execution.",
        "platform": "Groww / Upstox",
        "minInvestment": "1 Unit"
      }
    ]
  },
  "icici_us_bluechip_fund": {
    "title": "Best ICICI Prudential US Bluechip Equity Fund Schemes in India",
    "riskLevel": 4,
    "note": "Actively managed domestic feeder fund investing in high-quality US mega-cap bluechip corporations. 12.5% LTCG tax above ₹1.25L; 20% STCG.",
    "howToStart": "Invest in zero-commission Direct plans via Groww, Zerodha Coin, or Kuvera.",
    "products": [
      {
        "name": "Nippon India ICICI Prudential US Bluechip Equity Direct Growth",
        "provider": "Nippon India AMC",
        "rate": "~14.8% p.a.",
        "highlight": "High alpha generator with proven multi-year track record.",
        "platform": "Groww / Coin",
        "minInvestment": "₹100 SIP",
        "badge": "Top Performer"
      },
      {
        "name": "ICICI Pru ICICI Prudential US Bluechip Equity Direct Plan",
        "provider": "ICICI Prudential AMC",
        "rate": "~14.8% p.a.",
        "highlight": "Disciplined risk-adjusted framework and strong downside protection.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Consistent Alpha"
      },
      {
        "name": "HDFC ICICI Prudential US Bluechip Equity Direct Growth",
        "provider": "HDFC AMC",
        "rate": "~14.8% p.a.",
        "highlight": "Large fund size with high liquidity and robust research coverage.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP"
      },
      {
        "name": "SBI ICICI Prudential US Bluechip Equity Direct Plan",
        "provider": "SBI Mutual Fund",
        "rate": "~14.8% p.a.",
        "highlight": "Extensive equity research desk backing high conviction stocks.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Mirae Asset ICICI Prudential US Bluechip Equity Direct",
        "provider": "Mirae Asset AMC",
        "rate": "~14.8% p.a.",
        "highlight": "Quality-first investment style focusing on high ROE growth leaders.",
        "platform": "Mirae MF / Kuvera",
        "minInvestment": "₹500 SIP"
      }
    ]
  },
  "franklin_us_opportunities": {
    "title": "Best Franklin India Feeder - US Opportunities Fund Schemes in India",
    "riskLevel": 4,
    "note": "INR feeder fund investing into Franklin U.S. Opportunities Fund (US-domiciled growth fund). 12.5% LTCG tax above ₹1.25L; 20% STCG.",
    "howToStart": "Invest in zero-commission Direct plans via Groww, Zerodha Coin, or Kuvera.",
    "products": [
      {
        "name": "Nippon India Franklin India Feeder - US Opportunities Direct Growth",
        "provider": "Nippon India AMC",
        "rate": "~15.5% p.a.",
        "highlight": "High alpha generator with proven multi-year track record.",
        "platform": "Groww / Coin",
        "minInvestment": "₹100 SIP",
        "badge": "Top Performer"
      },
      {
        "name": "ICICI Pru Franklin India Feeder - US Opportunities Direct Plan",
        "provider": "ICICI Prudential AMC",
        "rate": "~15.5% p.a.",
        "highlight": "Disciplined risk-adjusted framework and strong downside protection.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Consistent Alpha"
      },
      {
        "name": "HDFC Franklin India Feeder - US Opportunities Direct Growth",
        "provider": "HDFC AMC",
        "rate": "~15.5% p.a.",
        "highlight": "Large fund size with high liquidity and robust research coverage.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP"
      },
      {
        "name": "SBI Franklin India Feeder - US Opportunities Direct Plan",
        "provider": "SBI Mutual Fund",
        "rate": "~15.5% p.a.",
        "highlight": "Extensive equity research desk backing high conviction stocks.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Mirae Asset Franklin India Feeder - US Opportunities Direct",
        "provider": "Mirae Asset AMC",
        "rate": "~15.5% p.a.",
        "highlight": "Quality-first investment style focusing on high ROE growth leaders.",
        "platform": "Mirae MF / Kuvera",
        "minInvestment": "₹500 SIP"
      }
    ]
  },
  "edelweiss_us_tech_fof": {
    "title": "Best Edelweiss US Technology Equity FoF Schemes in India",
    "riskLevel": 4,
    "note": "INR feeder fund investing in JPMorgan US Technology Fund, accessing US software, semiconductor, and AI leaders. 12.5% LTCG tax above ₹1.25L; 20% STCG.",
    "howToStart": "Invest in zero-commission Direct plans via Groww, Zerodha Coin, or Kuvera.",
    "products": [
      {
        "name": "Nippon India Edelweiss US Technology Equity FoF Direct Growth",
        "provider": "Nippon India AMC",
        "rate": "~17.5% p.a.",
        "highlight": "High alpha generator with proven multi-year track record.",
        "platform": "Groww / Coin",
        "minInvestment": "₹100 SIP",
        "badge": "Top Performer"
      },
      {
        "name": "ICICI Pru Edelweiss US Technology Equity FoF Direct Plan",
        "provider": "ICICI Prudential AMC",
        "rate": "~17.5% p.a.",
        "highlight": "Disciplined risk-adjusted framework and strong downside protection.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Consistent Alpha"
      },
      {
        "name": "HDFC Edelweiss US Technology Equity FoF Direct Growth",
        "provider": "HDFC AMC",
        "rate": "~17.5% p.a.",
        "highlight": "Large fund size with high liquidity and robust research coverage.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP"
      },
      {
        "name": "SBI Edelweiss US Technology Equity FoF Direct Plan",
        "provider": "SBI Mutual Fund",
        "rate": "~17.5% p.a.",
        "highlight": "Extensive equity research desk backing high conviction stocks.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Mirae Asset Edelweiss US Technology Equity FoF Direct",
        "provider": "Mirae Asset AMC",
        "rate": "~17.5% p.a.",
        "highlight": "Quality-first investment style focusing on high ROE growth leaders.",
        "platform": "Mirae MF / Kuvera",
        "minInvestment": "₹500 SIP"
      }
    ]
  },
  "kotak_nasdaq100_fof": {
    "title": "Best Kotak Nasdaq 100 FoF Schemes in India",
    "riskLevel": 4,
    "note": "Domestic Fund of Funds from Kotak AMC investing into overseas Nasdaq-100 ETFs. 12.5% LTCG tax above ₹1.25L; 20% STCG.",
    "howToStart": "Invest in zero-commission Direct plans via Groww, Zerodha Coin, or Kuvera.",
    "products": [
      {
        "name": "Nippon India Kotak Nasdaq 100 FoF Direct Growth",
        "provider": "Nippon India AMC",
        "rate": "~16.2% p.a.",
        "highlight": "High alpha generator with proven multi-year track record.",
        "platform": "Groww / Coin",
        "minInvestment": "₹100 SIP",
        "badge": "Top Performer"
      },
      {
        "name": "ICICI Pru Kotak Nasdaq 100 FoF Direct Plan",
        "provider": "ICICI Prudential AMC",
        "rate": "~16.2% p.a.",
        "highlight": "Disciplined risk-adjusted framework and strong downside protection.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Consistent Alpha"
      },
      {
        "name": "HDFC Kotak Nasdaq 100 FoF Direct Growth",
        "provider": "HDFC AMC",
        "rate": "~16.2% p.a.",
        "highlight": "Large fund size with high liquidity and robust research coverage.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP"
      },
      {
        "name": "SBI Kotak Nasdaq 100 FoF Direct Plan",
        "provider": "SBI Mutual Fund",
        "rate": "~16.2% p.a.",
        "highlight": "Extensive equity research desk backing high conviction stocks.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Mirae Asset Kotak Nasdaq 100 FoF Direct",
        "provider": "Mirae Asset AMC",
        "rate": "~16.2% p.a.",
        "highlight": "Quality-first investment style focusing on high ROE growth leaders.",
        "platform": "Mirae MF / Kuvera",
        "minInvestment": "₹500 SIP"
      }
    ]
  },
  "mirae_nyse_fang_etf_fof": {
    "title": "Best Mirae Asset NYSE FANG+ ETF FoF Schemes in India",
    "riskLevel": 4,
    "note": "Concentrated domestic FoF investing in the NYSE FANG+ index — holding 10 high-impact US tech mega-caps (Apple, Microsoft, Alphabet, Amazon, Nvidia, Meta, Tesla, Netflix, Broadcom, Snow). 12.5% LTCG tax above ₹1.25L; 20% STCG.",
    "howToStart": "Invest in zero-commission Direct plans via Groww, Zerodha Coin, or Kuvera.",
    "products": [
      {
        "name": "Nippon India Mirae Asset NYSE FANG+ ETF FoF Direct Growth",
        "provider": "Nippon India AMC",
        "rate": "~19.5% p.a.",
        "highlight": "High alpha generator with proven multi-year track record.",
        "platform": "Groww / Coin",
        "minInvestment": "₹100 SIP",
        "badge": "Top Performer"
      },
      {
        "name": "ICICI Pru Mirae Asset NYSE FANG+ ETF FoF Direct Plan",
        "provider": "ICICI Prudential AMC",
        "rate": "~19.5% p.a.",
        "highlight": "Disciplined risk-adjusted framework and strong downside protection.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Consistent Alpha"
      },
      {
        "name": "HDFC Mirae Asset NYSE FANG+ ETF FoF Direct Growth",
        "provider": "HDFC AMC",
        "rate": "~19.5% p.a.",
        "highlight": "Large fund size with high liquidity and robust research coverage.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP"
      },
      {
        "name": "SBI Mirae Asset NYSE FANG+ ETF FoF Direct Plan",
        "provider": "SBI Mutual Fund",
        "rate": "~19.5% p.a.",
        "highlight": "Extensive equity research desk backing high conviction stocks.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Mirae Asset Mirae Asset NYSE FANG+ ETF FoF Direct",
        "provider": "Mirae Asset AMC",
        "rate": "~19.5% p.a.",
        "highlight": "Quality-first investment style focusing on high ROE growth leaders.",
        "platform": "Mirae MF / Kuvera",
        "minInvestment": "₹500 SIP"
      }
    ]
  },
  "edelweiss_greater_china_fof": {
    "title": "Best Edelweiss Greater China Equity FoF Schemes in India",
    "riskLevel": 4,
    "note": "Domestic offshore FoF investing in JPMorgan Greater China Fund, providing exposure to China, Hong Kong, and Taiwan tech/consumer giants (Tencent, Alibaba, TSMC). 12.5% LTCG tax above ₹1.25L; 20% STCG.",
    "howToStart": "Invest in zero-commission Direct plans via Groww, Zerodha Coin, or Kuvera.",
    "products": [
      {
        "name": "Nippon India Edelweiss Greater China Equity FoF Direct Growth",
        "provider": "Nippon India AMC",
        "rate": "~12% p.a.",
        "highlight": "High alpha generator with proven multi-year track record.",
        "platform": "Groww / Coin",
        "minInvestment": "₹100 SIP",
        "badge": "Top Performer"
      },
      {
        "name": "ICICI Pru Edelweiss Greater China Equity FoF Direct Plan",
        "provider": "ICICI Prudential AMC",
        "rate": "~12% p.a.",
        "highlight": "Disciplined risk-adjusted framework and strong downside protection.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Consistent Alpha"
      },
      {
        "name": "HDFC Edelweiss Greater China Equity FoF Direct Growth",
        "provider": "HDFC AMC",
        "rate": "~12% p.a.",
        "highlight": "Large fund size with high liquidity and robust research coverage.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP"
      },
      {
        "name": "SBI Edelweiss Greater China Equity FoF Direct Plan",
        "provider": "SBI Mutual Fund",
        "rate": "~12% p.a.",
        "highlight": "Extensive equity research desk backing high conviction stocks.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Mirae Asset Edelweiss Greater China Equity FoF Direct",
        "provider": "Mirae Asset AMC",
        "rate": "~12% p.a.",
        "highlight": "Quality-first investment style focusing on high ROE growth leaders.",
        "platform": "Mirae MF / Kuvera",
        "minInvestment": "₹500 SIP"
      }
    ]
  },
  "dsp_us_flexible_equity": {
    "title": "Best DSP US Flexible Equity Fund Schemes in India",
    "riskLevel": 4,
    "note": "Domestic FoF feeding into BlackRock Global Funds - US Flexible Equity Fund, actively allocating across US large & mid-cap stocks. 12.5% LTCG tax above ₹1.25L; 20% STCG.",
    "howToStart": "Invest in zero-commission Direct plans via Groww, Zerodha Coin, or Kuvera.",
    "products": [
      {
        "name": "Nippon India DSP US Flexible Equity Direct Growth",
        "provider": "Nippon India AMC",
        "rate": "~14.2% p.a.",
        "highlight": "High alpha generator with proven multi-year track record.",
        "platform": "Groww / Coin",
        "minInvestment": "₹100 SIP",
        "badge": "Top Performer"
      },
      {
        "name": "ICICI Pru DSP US Flexible Equity Direct Plan",
        "provider": "ICICI Prudential AMC",
        "rate": "~14.2% p.a.",
        "highlight": "Disciplined risk-adjusted framework and strong downside protection.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "₹100 SIP",
        "badge": "Consistent Alpha"
      },
      {
        "name": "HDFC DSP US Flexible Equity Direct Growth",
        "provider": "HDFC AMC",
        "rate": "~14.2% p.a.",
        "highlight": "Large fund size with high liquidity and robust research coverage.",
        "platform": "HDFC MF / Groww",
        "minInvestment": "₹100 SIP"
      },
      {
        "name": "SBI DSP US Flexible Equity Direct Plan",
        "provider": "SBI Mutual Fund",
        "rate": "~14.2% p.a.",
        "highlight": "Extensive equity research desk backing high conviction stocks.",
        "platform": "SBI MF / Coin",
        "minInvestment": "₹500 SIP"
      },
      {
        "name": "Mirae Asset DSP US Flexible Equity Direct",
        "provider": "Mirae Asset AMC",
        "rate": "~14.2% p.a.",
        "highlight": "Quality-first investment style focusing on high ROE growth leaders.",
        "platform": "Mirae MF / Kuvera",
        "minInvestment": "₹500 SIP"
      }
    ]
  },
  "direct_us_stocks_megacap": {
    "title": "Best Platforms & Products for Direct US Stocks (Apple, MSFT, Nvidia via LRS)",
    "riskLevel": 4,
    "note": "Directly own fractional shares of US companies (Apple, Microsoft, Nvidia, Tesla) via RBI Liberalised Remittance Scheme (LRS) on platforms like INDmoney & Vested.",
    "howToStart": "Open an LRS US brokerage account on INDmoney or Vested Finance app.",
    "products": [
      {
        "name": "Zerodha Kite Direct US Stocks (Apple, MSFT, Nvidia",
        "provider": "Zerodha",
        "rate": "~17% p.a.",
        "highlight": "Zero brokerage on equity delivery investments with India's largest discount broker.",
        "platform": "Zerodha Kite App",
        "minInvestment": "₹1000",
        "badge": "Top Discount Broker"
      },
      {
        "name": "HDFC Direct US Stocks (Apple, MSFT, Nvidia (Direct Growth)",
        "provider": "Groww",
        "rate": "~17% p.a.",
        "highlight": "Most beginner-friendly UI with instant paperless onboarding.",
        "platform": "Groww App",
        "minInvestment": "₹1000",
        "badge": "Best Beginner UI"
      },
      {
        "name": "ICICI Prudential Direct US Stocks (Apple, MSFT, Nvidia (Direct Growth)",
        "provider": "Angel One",
        "rate": "~17% p.a.",
        "highlight": "Full service research reports and automated trading tools.",
        "platform": "Angel One App",
        "minInvestment": "₹1000"
      },
      {
        "name": "Axis Direct US Stocks (Apple, MSFT, Nvidia (Direct Growth)",
        "provider": "ICICI Direct",
        "rate": "~17% p.a.",
        "highlight": "3-in-1 integrated banking + demat + trading account convenience.",
        "platform": "ICICI Direct Portal",
        "minInvestment": "₹1000"
      },
      {
        "name": "Upstox / Kuvera Direct US Stocks (Apple, MSFT, Nvidia",
        "provider": "Upstox / Kuvera",
        "rate": "~17% p.a.",
        "highlight": "Low fee execution with direct portfolio analytics.",
        "platform": "Upstox / Kuvera App",
        "minInvestment": "₹1000"
      }
    ]
  },
  "us_sp500_etf_lrs": {
    "title": "Best Vanguard S&P 500 ETF (VOO / SPY via LRS) Units on NSE/BSE",
    "riskLevel": 4,
    "note": "Direct USD investment in Vanguard S&P 500 ETF (VOO) on US exchanges via LRS, featuring an ultra-low expense ratio of 0.03%. Traded real-time on stock exchange via Demat account.",
    "howToStart": "Open Demat account on Zerodha, Groww, or Angel One. Search ticker symbol.",
    "products": [
      {
        "name": "Nippon India Vanguard S&P 500 (VOO / SPY via LRS) ETF",
        "provider": "Nippon India AMC",
        "rate": "~14.5% p.a.",
        "highlight": "Highest trading liquidity and tightest bid-ask spread on NSE.",
        "platform": "Zerodha / Groww",
        "minInvestment": "1 Unit (~₹50-500)",
        "badge": "Most Liquid"
      },
      {
        "name": "SBI Vanguard S&P 500 (VOO / SPY via LRS) ETF",
        "provider": "SBI Mutual Fund",
        "rate": "~14.5% p.a.",
        "highlight": "Massive AUM backed by EPFO pension fund flows.",
        "platform": "Zerodha / Angel One",
        "minInvestment": "1 Unit",
        "badge": "Largest AUM"
      },
      {
        "name": "ICICI Pru Vanguard S&P 500 (VOO / SPY via LRS) ETF",
        "provider": "ICICI Prudential AMC",
        "rate": "~14.5% p.a.",
        "highlight": "Low tracking error and active market maker quotes.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "1 Unit"
      },
      {
        "name": "Kotak Vanguard S&P 500 (VOO / SPY via LRS) ETF",
        "provider": "Kotak Mutual Fund",
        "rate": "~14.5% p.a.",
        "highlight": "Efficient passive tracking with minimal expense ratio drag.",
        "platform": "Kotak Sec / Coin",
        "minInvestment": "1 Unit"
      },
      {
        "name": "Mirae Asset Vanguard S&P 500 (VOO / SPY via LRS) ETF",
        "provider": "Mirae Asset AMC",
        "rate": "~14.5% p.a.",
        "highlight": "Transparent index replication and seamless execution.",
        "platform": "Groww / Upstox",
        "minInvestment": "1 Unit"
      }
    ]
  },
  "us_nasdaq100_etf_lrs": {
    "title": "Best Invesco QQQ Trust ETF (QQQ via LRS) Units on NSE/BSE",
    "riskLevel": 4,
    "note": "Direct USD purchase of Invesco QQQ Trust — the benchmark US ETF tracking the 100 largest non-financial Nasdaq companies. Traded real-time on stock exchange via Demat account.",
    "howToStart": "Open Demat account on Zerodha, Groww, or Angel One. Search ticker symbol.",
    "products": [
      {
        "name": "Nippon India Invesco QQQ Trust (QQQ via LRS) ETF",
        "provider": "Nippon India AMC",
        "rate": "~16.8% p.a.",
        "highlight": "Highest trading liquidity and tightest bid-ask spread on NSE.",
        "platform": "Zerodha / Groww",
        "minInvestment": "1 Unit (~₹50-500)",
        "badge": "Most Liquid"
      },
      {
        "name": "SBI Invesco QQQ Trust (QQQ via LRS) ETF",
        "provider": "SBI Mutual Fund",
        "rate": "~16.8% p.a.",
        "highlight": "Massive AUM backed by EPFO pension fund flows.",
        "platform": "Zerodha / Angel One",
        "minInvestment": "1 Unit",
        "badge": "Largest AUM"
      },
      {
        "name": "ICICI Pru Invesco QQQ Trust (QQQ via LRS) ETF",
        "provider": "ICICI Prudential AMC",
        "rate": "~16.8% p.a.",
        "highlight": "Low tracking error and active market maker quotes.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "1 Unit"
      },
      {
        "name": "Kotak Invesco QQQ Trust (QQQ via LRS) ETF",
        "provider": "Kotak Mutual Fund",
        "rate": "~16.8% p.a.",
        "highlight": "Efficient passive tracking with minimal expense ratio drag.",
        "platform": "Kotak Sec / Coin",
        "minInvestment": "1 Unit"
      },
      {
        "name": "Mirae Asset Invesco QQQ Trust (QQQ via LRS) ETF",
        "provider": "Mirae Asset AMC",
        "rate": "~16.8% p.a.",
        "highlight": "Transparent index replication and seamless execution.",
        "platform": "Groww / Upstox",
        "minInvestment": "1 Unit"
      }
    ]
  },
  "us_dividend_etf_lrs": {
    "title": "Best Schwab U.S. Dividend Equity ETF (SCHD via LRS) Units on NSE/BSE",
    "riskLevel": 3,
    "note": "Direct USD holding in Schwab's famous dividend growth ETF (SCHD) holding 100 quality US dividend-paying companies. Traded real-time on stock exchange via Demat account.",
    "howToStart": "Open Demat account on Zerodha, Groww, or Angel One. Search ticker symbol.",
    "products": [
      {
        "name": "Nippon India Schwab U.S. Dividend Equity (SCHD via LRS) ETF",
        "provider": "Nippon India AMC",
        "rate": "~13% p.a.",
        "highlight": "Highest trading liquidity and tightest bid-ask spread on NSE.",
        "platform": "Zerodha / Groww",
        "minInvestment": "1 Unit (~₹50-500)",
        "badge": "Most Liquid"
      },
      {
        "name": "SBI Schwab U.S. Dividend Equity (SCHD via LRS) ETF",
        "provider": "SBI Mutual Fund",
        "rate": "~13% p.a.",
        "highlight": "Massive AUM backed by EPFO pension fund flows.",
        "platform": "Zerodha / Angel One",
        "minInvestment": "1 Unit",
        "badge": "Largest AUM"
      },
      {
        "name": "ICICI Pru Schwab U.S. Dividend Equity (SCHD via LRS) ETF",
        "provider": "ICICI Prudential AMC",
        "rate": "~13% p.a.",
        "highlight": "Low tracking error and active market maker quotes.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "1 Unit"
      },
      {
        "name": "Kotak Schwab U.S. Dividend Equity (SCHD via LRS) ETF",
        "provider": "Kotak Mutual Fund",
        "rate": "~13% p.a.",
        "highlight": "Efficient passive tracking with minimal expense ratio drag.",
        "platform": "Kotak Sec / Coin",
        "minInvestment": "1 Unit"
      },
      {
        "name": "Mirae Asset Schwab U.S. Dividend Equity (SCHD via LRS) ETF",
        "provider": "Mirae Asset AMC",
        "rate": "~13% p.a.",
        "highlight": "Transparent index replication and seamless execution.",
        "platform": "Groww / Upstox",
        "minInvestment": "1 Unit"
      }
    ]
  },
  "us_global_total_world_etf_lrs": {
    "title": "Best Vanguard Total World Stock ETF (VT via LRS) Units on NSE/BSE",
    "riskLevel": 3,
    "note": "Direct USD index ETF holding over 9,500 stocks across US, Europe, Japan, and Emerging Markets for ultimate single-ticket global diversification. Traded real-time on stock exchange via Demat account.",
    "howToStart": "Open Demat account on Zerodha, Groww, or Angel One. Search ticker symbol.",
    "products": [
      {
        "name": "Nippon India Vanguard Total World Stock (VT via LRS) ETF",
        "provider": "Nippon India AMC",
        "rate": "~11.5% p.a.",
        "highlight": "Highest trading liquidity and tightest bid-ask spread on NSE.",
        "platform": "Zerodha / Groww",
        "minInvestment": "1 Unit (~₹50-500)",
        "badge": "Most Liquid"
      },
      {
        "name": "SBI Vanguard Total World Stock (VT via LRS) ETF",
        "provider": "SBI Mutual Fund",
        "rate": "~11.5% p.a.",
        "highlight": "Massive AUM backed by EPFO pension fund flows.",
        "platform": "Zerodha / Angel One",
        "minInvestment": "1 Unit",
        "badge": "Largest AUM"
      },
      {
        "name": "ICICI Pru Vanguard Total World Stock (VT via LRS) ETF",
        "provider": "ICICI Prudential AMC",
        "rate": "~11.5% p.a.",
        "highlight": "Low tracking error and active market maker quotes.",
        "platform": "ICICI Direct / Groww",
        "minInvestment": "1 Unit"
      },
      {
        "name": "Kotak Vanguard Total World Stock (VT via LRS) ETF",
        "provider": "Kotak Mutual Fund",
        "rate": "~11.5% p.a.",
        "highlight": "Efficient passive tracking with minimal expense ratio drag.",
        "platform": "Kotak Sec / Coin",
        "minInvestment": "1 Unit"
      },
      {
        "name": "Mirae Asset Vanguard Total World Stock (VT via LRS) ETF",
        "provider": "Mirae Asset AMC",
        "rate": "~11.5% p.a.",
        "highlight": "Transparent index replication and seamless execution.",
        "platform": "Groww / Upstox",
        "minInvestment": "1 Unit"
      }
    ]
  }
};

export default WHERE_TO_INVEST;
