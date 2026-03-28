#!/usr/bin/env python3
"""
Example Competitor Scraper
==========================

This script demonstrates how to use the competitor configuration system
to scrape product information from configured competitors.

Usage:
    python example_scraper.py --competitor amazon --url "https://www.amazon.com/dp/B08N5WRWNW"
    python example_scraper.py --list-competitors
"""

import argparse
import json
import logging
import re
import time
from typing import Dict, Optional, Any
from dataclasses import dataclass
from urllib.parse import urljoin, urlparse

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    logger.error("Required packages not installed. Run: pip install requests beautifulsoup4")
    raise


@dataclass
class ScrapedProduct:
    """Data class for scraped product information."""
    name: Optional[str]
    price: Optional[float]
    currency: str
    availability: Optional[str]
    url: str
    competitor: str
    scraped_at: str
    raw_data: Dict[str, Any]


class CompetitorScraper:
    """
    Scraper that uses competitor configuration to extract product data.
    
    This class demonstrates best practices for:
    - Loading configuration
    - Respecting rate limits
    - Handling retries with exponential backoff
    - Using proper headers to avoid blocking
    """
    
    def __init__(self, config_loader, competitor_key: str):
        """
        Initialize the scraper for a specific competitor.
        
        Args:
            config_loader: ConfigLoader instance with loaded configurations
            competitor_key: Key identifying the competitor to scrape
        """
        from config_loader import ConfigLoader
        self.config_loader: ConfigLoader = config_loader
        self.competitor_key = competitor_key
        self.competitor_config = config_loader.get_competitor(competitor_key)
        self.session = requests.Session()
        
        # Set up session with headers from config
        headers = config_loader.get_headers(competitor_key)
        self.session.headers.update(headers)
        
        # Load retry and rate limit config
        self.retry_config = config_loader.get_retry_config(competitor_key)
        self.rate_config = config_loader.get_rate_limit_config(competitor_key)
        
        self._last_request_time = 0
        
        logger.info(f"Initialized scraper for {self.competitor_config['name']}")
    
    def _rate_limit(self):
        """Enforce rate limiting between requests."""
        min_delay = self.rate_config.delay_between_requests_ms / 1000
        jitter = (self.rate_config.jitter_ms / 1000) * (hash(time.time()) % 100 / 100)
        delay = min_delay + jitter
        
        elapsed = time.time() - self._last_request_time
        if elapsed < delay:
            sleep_time = delay - elapsed
            logger.debug(f"Rate limiting: sleeping {sleep_time:.2f}s")
            time.sleep(sleep_time)
        
        self._last_request_time = time.time()
    
    def _make_request(self, url: str) -> requests.Response:
        """
        Make HTTP request with retry logic and rate limiting.
        
        Args:
            url: URL to request
            
        Returns:
            Response object
            
        Raises:
            Exception: If all retries exhausted
        """
        self._rate_limit()
        
        last_exception = None
        delay = self.retry_config.retry_delay_seconds
        
        for attempt in range(self.retry_config.max_retries + 1):
            try:
                logger.info(f"Requesting {url} (attempt {attempt + 1})")
                
                timeout = self.competitor_config.get('request_config', {}).get('timeout_seconds', 30)
                response = self.session.get(url, timeout=timeout, allow_redirects=True)
                
                # Check if we should retry based on status code
                if response.status_code in self.retry_config.retry_on_status_codes:
                    raise requests.HTTPError(
                        f"Status {response.status_code} in retry list",
                        response=response
                    )
                
                response.raise_for_status()
                return response
                
            except Exception as e:
                last_exception = e
                
                if attempt < self.retry_config.max_retries:
                    logger.warning(f"Request failed (attempt {attempt + 1}): {e}")
                    logger.info(f"Retrying in {delay:.1f} seconds...")
                    time.sleep(delay)
                    delay *= self.retry_config.backoff_multiplier
                else:
                    logger.error(f"All retries exhausted for {url}")
        
        raise last_exception
    
    def _extract_with_selector(self, soup: BeautifulSoup, selector_config: Dict) -> Optional[str]:
        """
        Extract text using a selector configuration with fallbacks.
        
        Args:
            soup: BeautifulSoup object
            selector_config: Selector configuration dict
            
        Returns:
            Extracted text or None
        """
        selectors = [selector_config['primary']] + selector_config.get('fallbacks', [])
        attribute = selector_config.get('attribute', 'textContent')
        
        for selector in selectors:
            try:
                element = soup.select_one(selector)
                if element:
                    if attribute == 'textContent':
                        value = element.get_text(strip=True)
                    else:
                        value = element.get(attribute, '')
                    
                    if value:
                        # Strip whitespace if configured
                        if selector_config.get('strip_whitespace', True):
                            value = ' '.join(value.split())
                        
                        # Truncate if max_length specified
                        max_length = selector_config.get('max_length')
                        if max_length and len(value) > max_length:
                            value = value[:max_length] + '...'
                        
                        return value
            except Exception as e:
                logger.debug(f"Selector '{selector}' failed: {e}")
                continue
        
        return None
    
    def _extract_price(self, soup: BeautifulSoup) -> tuple[Optional[float], str]:
        """
        Extract price and currency from page.
        
        Args:
            soup: BeautifulSoup object
            
        Returns:
            Tuple of (price_value, currency_code)
        """
        price_config = self.competitor_config['selectors']['product_page']['price']
        raw_price = self._extract_with_selector(soup, price_config)
        
        if not raw_price:
            return None, 'USD'
        
        # Extract numeric value using regex
        regex_pattern = price_config.get('regex_pattern', r'([0-9.,]+)')
        match = re.search(regex_pattern, raw_price)
        
        if match:
            price_str = match.group(1)
            # Handle different number formats
            currency_config = self.config_loader.get_currency_config(self.competitor_key)
            thousands_sep = currency_config.get('thousands_separator', ',')
            decimal_sep = currency_config.get('decimal_separator', '.')
            
            # Normalize to standard float
            price_str = price_str.replace(thousands_sep, '')
            if decimal_sep != '.':
                price_str = price_str.replace(decimal_sep, '.')
            
            try:
                price = float(price_str)
                currency = currency_config.get('code', 'USD')
                return price, currency
            except ValueError:
                logger.warning(f"Could not parse price: {price_str}")
        
        return None, 'USD'
    
    def _extract_availability(self, soup: BeautifulSoup) -> Optional[str]:
        """Extract availability status from page."""
        availability_config = self.competitor_config['selectors']['product_page'].get('availability')
        
        if not availability_config:
            return None
        
        selector = availability_config.get('selector')
        if not selector:
            return None
        
        element = soup.select_one(selector)
        if not element:
            return None
        
        text = element.get_text(strip=True).lower()
        
        in_stock_keywords = availability_config.get('in_stock_keywords', ['in stock'])
        out_of_stock_keywords = availability_config.get('out_of_stock_keywords', ['out of stock'])
        
        for keyword in in_stock_keywords:
            if keyword.lower() in text:
                return 'in_stock'
        
        for keyword in out_of_stock_keywords:
            if keyword.lower() in text:
                return 'out_of_stock'
        
        return text
    
    def scrape_product(self, url: str) -> ScrapedProduct:
        """
        Scrape a single product page.
        
        Args:
            url: Product page URL
            
        Returns:
            ScrapedProduct object with extracted data
        """
        from datetime import datetime
        
        # Validate URL belongs to this competitor
        base_url = self.config_loader.get_base_url(self.competitor_key)
        if not url.startswith(base_url):
            logger.warning(f"URL {url} doesn't match base URL {base_url}")
        
        # Make request
        response = self._make_request(url)
        soup = BeautifulSoup(response.content, 'html.parser')
        
        # Extract data
        name_config = self.competitor_config['selectors']['product_page']['product_name']
        product_name = self._extract_with_selector(soup, name_config)
        
        price, currency = self._extract_price(soup)
        availability = self._extract_availability(soup)
        
        # Build raw data dict for debugging
        raw_data = {
            'html_length': len(response.text),
            'status_code': response.status_code,
            'headers': dict(response.headers)
        }
        
        product = ScrapedProduct(
            name=product_name,
            price=price,
            currency=currency,
            availability=availability,
            url=url,
            competitor=self.competitor_key,
            scraped_at=datetime.now().isoformat(),
            raw_data=raw_data
        )
        
        logger.info(f"Scraped: {product_name} - ${price} ({availability})")
        
        return product


def list_competitors(config_loader):
    """Display all available competitors."""
    print("\n" + "=" * 60)
    print("Available Competitors")
    print("=" * 60)
    
    for key, config in config_loader.get_all_competitors().items():
        status = "✅" if config.get('enabled') else "❌"
        print(f"\n{status} {key}")
        print(f"   Name: {config['name']}")
        print(f"   URL: {config['base_url']}")
        print(f"   Status: {'Enabled' if config.get('enabled') else 'Disabled'}")


def main():
    parser = argparse.ArgumentParser(
        description='Scrape competitor product information',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python example_scraper.py --list-competitors
  python example_scraper.py --competitor amazon --url "https://www.amazon.com/dp/B08N5WRWNW"
  python example_scraper.py --competitor shopify_generic --url "https://store.myshopify.com/products/item"
        """
    )
    
    parser.add_argument('--competitor', type=str, help='Competitor key to scrape')
    parser.add_argument('--url', type=str, help='Product URL to scrape')
    parser.add_argument('--list-competitors', action='store_true', help='List all configured competitors')
    parser.add_argument('--output', type=str, default='scraped_product.json', help='Output JSON file')
    parser.add_argument('--verbose', '-v', action='store_true', help='Enable verbose logging')
    
    args = parser.parse_args()
    
    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)
    
    # Load configuration
    from config_loader import ConfigLoader
    config_loader = ConfigLoader()
    
    if args.list_competitors:
        list_competitors(config_loader)
        return
    
    if not args.competitor or not args.url:
        parser.error("--competitor and --url are required (or use --list-competitors)")
    
    # Validate competitor exists and is enabled
    try:
        competitor = config_loader.get_competitor(args.competitor)
        if not competitor.get('enabled'):
            logger.warning(f"Competitor '{args.competitor}' is disabled in configuration")
    except KeyError as e:
        logger.error(f"Competitor not found: {e}")
        list_competitors(config_loader)
        return
    
    # Scrape the product
    try:
        scraper = CompetitorScraper(config_loader, args.competitor)
        product = scraper.scrape_product(args.url)
        
        # Save to JSON
        output_data = {
            'name': product.name,
            'price': product.price,
            'currency': product.currency,
            'availability': product.availability,
            'url': product.url,
            'competitor': product.competitor,
            'scraped_at': product.scraped_at
        }
        
        with open(args.output, 'w', encoding='utf-8') as f:
            json.dump(output_data, f, indent=2, ensure_ascii=False)
        
        print("\n" + "=" * 60)
        print("Scraping Results")
        print("=" * 60)
        print(f"Product: {product.name}")
        print(f"Price: {product.currency} {product.price}")
        print(f"Availability: {product.availability}")
        print(f"Saved to: {args.output}")
        
    except Exception as e:
        logger.error(f"Scraping failed: {e}")
        raise


if __name__ == "__main__":
    main()
