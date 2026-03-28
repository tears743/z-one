#!/usr/bin/env python3
"""
Competitor Configuration Loader
===============================

This module provides utilities for loading, validating, and accessing
competitor scraping configurations from the JSON configuration file.

Usage:
    from config.config_loader import ConfigLoader
    
    loader = ConfigLoader()
    amazon_config = loader.get_competitor('amazon')
    price_selector = loader.get_price_selector('amazon')
"""

import json
import re
from pathlib import Path
from typing import Dict, List, Optional, Any, Union
from dataclasses import dataclass
from functools import lru_cache


@dataclass
class PriceSelector:
    """Represents a price extraction configuration."""
    primary: str
    fallbacks: List[str]
    attribute: str
    regex_pattern: Optional[str] = None
    currency_symbol: Optional[str] = None
    
    def get_all_selectors(self) -> List[str]:
        """Return all selectors in priority order."""
        return [self.primary] + self.fallbacks


@dataclass
class ProductNameSelector:
    """Represents a product name extraction configuration."""
    primary: str
    fallbacks: List[str]
    attribute: str
    strip_whitespace: bool = True
    max_length: Optional[int] = None


@dataclass
class RetryConfig:
    """Represents retry logic configuration."""
    max_retries: int
    retry_delay_seconds: float
    backoff_multiplier: float
    retry_on_status_codes: List[int]
    retry_on_exceptions: List[str]


@dataclass
class RateLimitConfig:
    """Represents rate limiting configuration."""
    requests_per_minute: int
    delay_between_requests_ms: int
    jitter_ms: int


class ConfigLoader:
    """
    Loads and provides access to competitor scraping configurations.
    
    Attributes:
        config_path: Path to the competitors.json file
        config: Loaded configuration dictionary
    """
    
    def __init__(self, config_path: Optional[str] = None):
        """
        Initialize the configuration loader.
        
        Args:
            config_path: Path to competitors.json. Defaults to config/competitors.json
        """
        if config_path is None:
            self.config_path = Path(__file__).parent / "competitors.json"
        else:
            self.config_path = Path(config_path)
        
        self.config: Dict[str, Any] = {}
        self._load_config()
    
    def _load_config(self) -> None:
        """Load the configuration from the JSON file."""
        try:
            with open(self.config_path, 'r', encoding='utf-8') as f:
                self.config = json.load(f)
        except FileNotFoundError:
            raise FileNotFoundError(
                f"Configuration file not found: {self.config_path}. "
                "Please ensure config/competitors.json exists."
            )
        except json.JSONDecodeError as e:
            raise ValueError(
                f"Invalid JSON in configuration file: {e}. "
                f"Please validate the JSON syntax."
            )
    
    def reload(self) -> None:
        """Reload the configuration from disk."""
        self._load_config()
    
    @lru_cache(maxsize=32)
    def get_competitor(self, competitor_key: str) -> Dict[str, Any]:
        """
        Get configuration for a specific competitor.
        
        Args:
            competitor_key: The key identifying the competitor (e.g., 'amazon')
            
        Returns:
            Dictionary containing the competitor configuration
            
        Raises:
            KeyError: If competitor_key is not found in configuration
        """
        competitors = self.config.get('competitors', {})
        if competitor_key not in competitors:
            available = list(competitors.keys())
            raise KeyError(
                f"Competitor '{competitor_key}' not found. "
                f"Available competitors: {available}"
            )
        return competitors[competitor_key]
    
    def get_all_competitors(self) -> Dict[str, Dict[str, Any]]:
        """Get all competitor configurations."""
        return self.config.get('competitors', {})
    
    def get_enabled_competitors(self) -> Dict[str, Dict[str, Any]]:
        """Get only enabled competitor configurations."""
        all_competitors = self.get_all_competitors()
        return {
            key: config for key, config in all_competitors.items()
            if config.get('enabled', False)
        }
    
    def get_price_selector(self, competitor_key: str) -> PriceSelector:
        """
        Get price selector configuration for a competitor.
        
        Args:
            competitor_key: The competitor identifier
            
        Returns:
            PriceSelector object with extraction rules
        """
        competitor = self.get_competitor(competitor_key)
        price_config = competitor['selectors']['product_page']['price']
        
        return PriceSelector(
            primary=price_config['primary'],
            fallbacks=price_config.get('fallbacks', []),
            attribute=price_config.get('attribute', 'textContent'),
            regex_pattern=price_config.get('regex_pattern'),
            currency_symbol=price_config.get('currency_symbol')
        )
    
    def get_product_name_selector(self, competitor_key: str) -> ProductNameSelector:
        """
        Get product name selector configuration for a competitor.
        
        Args:
            competitor_key: The competitor identifier
            
        Returns:
            ProductNameSelector object with extraction rules
        """
        competitor = self.get_competitor(competitor_key)
        name_config = competitor['selectors']['product_page']['product_name']
        
        return ProductNameSelector(
            primary=name_config['primary'],
            fallbacks=name_config.get('fallbacks', []),
            attribute=name_config.get('attribute', 'textContent'),
            strip_whitespace=name_config.get('strip_whitespace', True),
            max_length=name_config.get('max_length')
        )
    
    def get_retry_config(self, competitor_key: str) -> RetryConfig:
        """Get retry configuration for a competitor."""
        competitor = self.get_competitor(competitor_key)
        retry_config = competitor.get('retry_config', {})
        
        return RetryConfig(
            max_retries=retry_config.get('max_retries', 3),
            retry_delay_seconds=retry_config.get('retry_delay_seconds', 2.0),
            backoff_multiplier=retry_config.get('backoff_multiplier', 2.0),
            retry_on_status_codes=retry_config.get('retry_on_status_codes', [429, 500, 503]),
            retry_on_exceptions=retry_config.get('retry_on_exceptions', ['TimeoutError'])
        )
    
    def get_rate_limit_config(self, competitor_key: str) -> RateLimitConfig:
        """Get rate limiting configuration for a competitor."""
        competitor = self.get_competitor(competitor_key)
        rate_config = competitor.get('rate_limiting', {})
        
        return RateLimitConfig(
            requests_per_minute=rate_config.get('requests_per_minute', 30),
            delay_between_requests_ms=rate_config.get('delay_between_requests_ms', 2000),
            jitter_ms=rate_config.get('jitter_ms', 500)
        )
    
    def get_headers(self, competitor_key: str) -> Dict[str, str]:
        """Get request headers for a competitor."""
        competitor = self.get_competitor(competitor_key)
        return competitor.get('request_config', {}).get('headers', {})
    
    def get_base_url(self, competitor_key: str) -> str:
        """Get base URL for a competitor."""
        return self.get_competitor(competitor_key)['base_url']
    
    def get_currency_config(self, competitor_key: str) -> Dict[str, Any]:
        """Get currency configuration for a competitor."""
        return self.get_competitor(competitor_key).get('currency', {})
    
    def extract_price(
        self, 
        competitor_key: str, 
        text: str
    ) -> Optional[float]:
        """
        Extract numeric price from text using competitor's regex pattern.
        
        Args:
            competitor_key: The competitor identifier
            text: Raw text containing price (e.g., "$19.99")
            
        Returns:
            Float price value or None if extraction fails
            
        Example:
            >>> loader.extract_price('amazon', '$19.99')
            19.99
        """
        price_selector = self.get_price_selector(competitor_key)
        
        if price_selector.regex_pattern:
            match = re.search(price_selector.regex_pattern, text)
            if match:
                try:
                    # Remove thousands separator and convert
                    price_str = match.group(1).replace(',', '')
                    return float(price_str)
                except (ValueError, IndexError):
                    return None
        
        # Fallback: remove common currency symbols and parse
        cleaned = re.sub(r'[^\d.,]', '', text)
        cleaned = cleaned.replace(',', '')
        try:
            return float(cleaned)
        except ValueError:
            return None
    
    def validate_config(self, competitor_key: str) -> List[str]:
        """
        Validate a competitor's configuration.
        
        Args:
            competitor_key: The competitor to validate
            
        Returns:
            List of validation error messages (empty if valid)
        """
        errors = []
        
        try:
            competitor = self.get_competitor(competitor_key)
        except KeyError as e:
            return [str(e)]
        
        # Check required fields
        required_fields = ['name', 'base_url', 'selectors', 'currency']
        for field in required_fields:
            if field not in competitor:
                errors.append(f"Missing required field: {field}")
        
        # Validate selectors
        selectors = competitor.get('selectors', {})
        if 'product_page' not in selectors:
            errors.append("Missing 'product_page' in selectors")
        else:
            product_page = selectors['product_page']
            if 'price' not in product_page:
                errors.append("Missing 'price' selector in product_page")
            if 'product_name' not in product_page:
                errors.append("Missing 'product_name' selector in product_page")
        
        # Validate URL format
        base_url = competitor.get('base_url', '')
        if not base_url.startswith(('http://', 'https://')):
            errors.append(f"Invalid base_url format: {base_url}")
        
        # Validate retry config
        retry_config = competitor.get('retry_config', {})
        if retry_config.get('max_retries', 0) < 0:
            errors.append("max_retries must be non-negative")
        
        # Validate rate limiting
        rate_config = competitor.get('rate_limiting', {})
        if rate_config.get('requests_per_minute', 1) < 1:
            errors.append("requests_per_minute must be at least 1")
        
        return errors
    
    def get_global_settings(self) -> Dict[str, Any]:
        """Get global configuration settings."""
        return self.config.get('global_settings', {})


def create_example_config():
    """
    Generate an example competitor configuration.
    
    Returns:
        Dictionary containing example configuration
    """
    return {
        "example_store": {
            "name": "Example Store",
            "base_url": "https://www.example-store.com",
            "enabled": True,
            "selectors": {
                "product_page": {
                    "price": {
                        "primary": ".product-price",
                        "fallbacks": [".price", "[data-price]"],
                        "attribute": "textContent",
                        "regex_pattern": r"\$?([0-9,]+\.?[0-9]*)",
                        "currency_symbol": "$"
                    },
                    "product_name": {
                        "primary": "h1.product-title",
                        "fallbacks": [".product-name"],
                        "attribute": "textContent",
                        "strip_whitespace": True,
                        "max_length": 255
                    }
                }
            },
            "currency": {
                "code": "USD",
                "symbol": "$",
                "position": "prefix",
                "thousands_separator": ",",
                "decimal_separator": "."
            },
            "request_config": {
                "headers": {
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
                },
                "timeout_seconds": 30
            },
            "retry_config": {
                "max_retries": 3,
                "retry_delay_seconds": 2,
                "backoff_multiplier": 2,
                "retry_on_status_codes": [429, 500, 503],
                "retry_on_exceptions": ["TimeoutError"]
            },
            "rate_limiting": {
                "requests_per_minute": 30,
                "delay_between_requests_ms": 2000,
                "jitter_ms": 500
            }
        }
    }


if __name__ == "__main__":
    # Example usage and testing
    print("=" * 60)
    print("Competitor Configuration Loader")
    print("=" * 60)
    
    loader = ConfigLoader()
    
    print("\n📋 Available Competitors:")
    for key, config in loader.get_all_competitors().items():
        status = "✅ Enabled" if config.get('enabled') else "❌ Disabled"
        print(f"  • {key}: {config['name']} ({status})")
    
    print("\n🔍 Amazon Configuration Example:")
    try:
        amazon = loader.get_competitor('amazon')
        print(f"  Base URL: {amazon['base_url']}")
        print(f"  Price Selector: {amazon['selectors']['product_page']['price']['primary']}")
        
        price_selector = loader.get_price_selector('amazon')
        print(f"  All Price Selectors: {price_selector.get_all_selectors()}")
        
        retry = loader.get_retry_config('amazon')
        print(f"  Max Retries: {retry.max_retries}")
        
        rate_limit = loader.get_rate_limit_config('amazon')
        print(f"  Rate Limit: {rate_limit.requests_per_minute} req/min")
        
        # Test price extraction
        test_prices = ["$19.99", "$1,299.00", "€45.50"]
        print(f"\n💰 Price Extraction Tests:")
        for price in test_prices:
            extracted = loader.extract_price('amazon', price)
            print(f"  '{price}' → {extracted}")
        
    except KeyError as e:
        print(f"  Error: {e}")
    
    print("\n✅ Validation Check:")
    for key in loader.get_all_competitors().keys():
        errors = loader.validate_config(key)
        if errors:
            print(f"  ❌ {key}: {errors}")
        else:
            print(f"  ✅ {key}: Valid configuration")
    
    print("\n" + "=" * 60)
