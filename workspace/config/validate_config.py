#!/usr/bin/env python3
"""
Configuration Validator
=======================

Validates the competitors.json configuration file and reports any issues.

Usage:
    python validate_config.py              # Validate all configurations
    python validate_config.py --verbose    # Show detailed output
    python validate_config.py --fix        # Attempt to fix common issues
"""

import argparse
import json
import re
from pathlib import Path
from typing import Dict, List, Any, Tuple


class ConfigValidator:
    """Validates competitor configuration files."""
    
    def __init__(self, config_path: str = "competitors.json"):
        self.config_path = Path(config_path)
        self.config: Dict = {}
        self.errors: List[str] = []
        self.warnings: List[str] = []
        self.fixed_issues: List[str] = []
    
    def load_config(self) -> bool:
        """Load the configuration file."""
        try:
            with open(self.config_path, 'r', encoding='utf-8') as f:
                self.config = json.load(f)
            return True
        except FileNotFoundError:
            self.errors.append(f"Configuration file not found: {self.config_path}")
            return False
        except json.JSONDecodeError as e:
            self.errors.append(f"Invalid JSON: {e}")
            return False
    
    def validate_structure(self) -> bool:
        """Validate the overall structure of the configuration."""
        # Check top-level keys
        if 'competitors' not in self.config:
            self.errors.append("Missing 'competitors' key at root level")
            return False
        
        if not isinstance(self.config['competitors'], dict):
            self.errors.append("'competitors' must be a dictionary")
            return False
        
        # Check schema version
        if '_schema_version' not in self.config:
            self.warnings.append("Missing '_schema_version' field")
        
        return True
    
    def validate_competitor(self, key: str, config: Dict) -> bool:
        """Validate a single competitor configuration."""
        is_valid = True
        
        # Check required fields
        required_fields = ['name', 'base_url', 'selectors', 'currency']
        for field in required_fields:
            if field not in config:
                self.errors.append(f"[{key}] Missing required field: '{field}'")
                is_valid = False
        
        # Validate base_url
        if 'base_url' in config:
            base_url = config['base_url']
            if not isinstance(base_url, str):
                self.errors.append(f"[{key}] 'base_url' must be a string")
                is_valid = False
            elif not re.match(r'^https?://', base_url):
                self.errors.append(f"[{key}] 'base_url' must start with http:// or https://")
                is_valid = False
            elif not re.match(r'^https?://[^\s/]+\.[^\s/]+', base_url):
                self.warnings.append(f"[{key}] 'base_url' format looks unusual: {base_url}")
        
        # Validate selectors
        if 'selectors' in config:
            selectors = config['selectors']
            
            if 'product_page' not in selectors:
                self.errors.append(f"[{key}] Missing 'selectors.product_page'")
                is_valid = False
            else:
                product_page = selectors['product_page']
                
                # Validate price selector
                if 'price' not in product_page:
                    self.errors.append(f"[{key}] Missing 'selectors.product_page.price'")
                    is_valid = False
                else:
                    price_config = product_page['price']
                    if 'primary' not in price_config:
                        self.errors.append(f"[{key}] Price selector missing 'primary'")
                        is_valid = False
                    if 'fallbacks' in price_config and not isinstance(price_config['fallbacks'], list):
                        self.errors.append(f"[{key}] Price 'fallbacks' must be a list")
                        is_valid = False
                
                # Validate product_name selector
                if 'product_name' not in product_page:
                    self.errors.append(f"[{key}] Missing 'selectors.product_page.product_name'")
                    is_valid = False
                else:
                    name_config = product_page['product_name']
                    if 'primary' not in name_config:
                        self.errors.append(f"[{key}] Product name selector missing 'primary'")
                        is_valid = False
        
        # Validate currency
        if 'currency' in config:
            currency = config['currency']
            if 'code' not in currency:
                self.errors.append(f"[{key}] Currency missing 'code'")
                is_valid = False
        
        # Validate request_config
        if 'request_config' in config:
            request_config = config['request_config']
            if 'headers' not in request_config:
                self.warnings.append(f"[{key}] No custom headers defined (may cause blocking)")
            elif 'User-Agent' not in request_config.get('headers', {}):
                self.warnings.append(f"[{key}] No User-Agent header defined")
        
        # Validate retry_config
        if 'retry_config' in config:
            retry = config['retry_config']
            if retry.get('max_retries', 0) < 0:
                self.errors.append(f"[{key}] max_retries cannot be negative")
                is_valid = False
            if retry.get('retry_delay_seconds', 0) < 0:
                self.errors.append(f"[{key}] retry_delay_seconds cannot be negative")
                is_valid = False
        
        # Validate rate_limiting
        if 'rate_limiting' in config:
            rate = config['rate_limiting']
            rpm = rate.get('requests_per_minute', 0)
            if rpm < 1:
                self.errors.append(f"[{key}] requests_per_minute must be at least 1")
                is_valid = False
            elif rpm > 120:
                self.warnings.append(f"[{key}] requests_per_minute ({rpm}) is very high - may cause blocking")
        else:
            self.warnings.append(f"[{key}] No rate_limiting config - using defaults")
        
        return is_valid
    
    def validate_selectors(self, key: str, config: Dict) -> None:
        """Validate CSS selector syntax (basic checks)."""
        selectors = config.get('selectors', {})
        product_page = selectors.get('product_page', {})
        
        all_selectors = []
        
        # Collect all selectors
        if 'price' in product_page:
            price = product_page['price']
            all_selectors.append(('price.primary', price.get('primary', '')))
            all_selectors.extend([('price.fallback', f) for f in price.get('fallbacks', [])])
        
        if 'product_name' in product_page:
            name = product_page['product_name']
            all_selectors.append(('product_name.primary', name.get('primary', '')))
            all_selectors.extend([('product_name.fallback', f) for f in name.get('fallbacks', [])])
        
        # Basic selector validation
        for selector_type, selector in all_selectors:
            if not selector:
                self.warnings.append(f"[{key}] Empty {selector_type} selector")
                continue
            
            # Check for common issues
            if selector.startswith('.'):
                if ' ' in selector and not any(c in selector for c in ['>', '+', '~', '[', '#']):
                    self.warnings.append(
                        f"[{key}] {selector_type} '{selector}' - descendant selector may be too broad"
                    )
            
            # Check for potentially problematic patterns
            if re.search(r'\.css-[a-z0-9]+', selector):
                self.warnings.append(
                    f"[{key}] {selector_type} '{selector}' - CSS-in-JS classes may change frequently"
                )
    
    def run_validation(self) -> Tuple[bool, List[str], List[str]]:
        """Run all validation checks."""
        if not self.load_config():
            return False, self.errors, self.warnings
        
        if not self.validate_structure():
            return False, self.errors, self.warnings
        
        competitors = self.config.get('competitors', {})
        
        if not competitors:
            self.warnings.append("No competitors defined in configuration")
        
        for key, competitor_config in competitors.items():
            self.validate_competitor(key, competitor_config)
            self.validate_selectors(key, competitor_config)
        
        return len(self.errors) == 0, self.errors, self.warnings
    
    def generate_report(self, verbose: bool = False) -> str:
        """Generate a validation report."""
        lines = []
        lines.append("=" * 70)
        lines.append("Configuration Validation Report")
        lines.append("=" * 70)
        lines.append("")
        
        # Summary
        competitors = self.config.get('competitors', {})
        enabled = sum(1 for c in competitors.values() if c.get('enabled'))
        
        lines.append(f"Configuration file: {self.config_path}")
        lines.append(f"Schema version: {self.config.get('_schema_version', 'N/A')}")
        lines.append(f"Competitors defined: {len(competitors)}")
        lines.append(f"Competitors enabled: {enabled}")
        lines.append("")
        
        # Errors
        if self.errors:
            lines.append("❌ ERRORS (Must Fix):")
            lines.append("-" * 70)
            for error in self.errors:
                lines.append(f"  • {error}")
            lines.append("")
        
        # Warnings
        if self.warnings:
            lines.append("⚠️  WARNINGS (Recommended to Fix):")
            lines.append("-" * 70)
            for warning in self.warnings:
                lines.append(f"  • {warning}")
            lines.append("")
        
        # Competitor details
        if verbose and competitors:
            lines.append("📋 Competitor Details:")
            lines.append("-" * 70)
            for key, config in competitors.items():
                status = "✅" if config.get('enabled') else "❌"
                lines.append(f"\n{status} {key}")
                lines.append(f"   Name: {config.get('name', 'N/A')}")
                lines.append(f"   Base URL: {config.get('base_url', 'N/A')}")
                
                # Show selectors
                selectors = config.get('selectors', {}).get('product_page', {})
                if 'price' in selectors:
                    price = selectors['price']
                    lines.append(f"   Price Selector: {price.get('primary', 'N/A')}")
                    lines.append(f"   Price Fallbacks: {len(price.get('fallbacks', []))}")
                
                if 'rate_limiting' in config:
                    rate = config['rate_limiting']
                    lines.append(f"   Rate Limit: {rate.get('requests_per_minute')} req/min")
            lines.append("")
        
        # Final status
        lines.append("=" * 70)
        if not self.errors:
            lines.append("✅ Configuration is valid!")
        else:
            lines.append(f"❌ Found {len(self.errors)} error(s) and {len(self.warnings)} warning(s)")
        lines.append("=" * 70)
        
        return "\n".join(lines)
    
    def fix_common_issues(self) -> None:
        """Attempt to fix common configuration issues."""
        if not self.config:
            return
        
        competitors = self.config.get('competitors', {})
        
        for key, config in competitors.items():
            # Ensure enabled field exists
            if 'enabled' not in config:
                config['enabled'] = False
                self.fixed_issues.append(f"[{key}] Added missing 'enabled: false'")
            
            # Ensure fallbacks is a list
            selectors = config.get('selectors', {}).get('product_page', {})
            if 'price' in selectors and 'fallbacks' not in selectors['price']:
                selectors['price']['fallbacks'] = []
                self.fixed_issues.append(f"[{key}] Added empty price fallbacks list")
            
            if 'product_name' in selectors and 'fallbacks' not in selectors['product_name']:
                selectors['product_name']['fallbacks'] = []
                self.fixed_issues.append(f"[{key}] Added empty product_name fallbacks list")
            
            # Ensure retry_config exists
            if 'retry_config' not in config:
                config['retry_config'] = {
                    "max_retries": 3,
                    "retry_delay_seconds": 2,
                    "backoff_multiplier": 2,
                    "retry_on_status_codes": [429, 500, 502, 503, 504],
                    "retry_on_exceptions": ["TimeoutError", "ConnectionError"]
                }
                self.fixed_issues.append(f"[{key}] Added default retry_config")
            
            # Ensure rate_limiting exists
            if 'rate_limiting' not in config:
                config['rate_limiting'] = {
                    "requests_per_minute": 30,
                    "delay_between_requests_ms": 2000,
                    "jitter_ms": 500
                }
                self.fixed_issues.append(f"[{key}] Added default rate_limiting")
        
        # Save fixed config
        with open(self.config_path, 'w', encoding='utf-8') as f:
            json.dump(self.config, f, indent=2, ensure_ascii=False)


def main():
    parser = argparse.ArgumentParser(
        description='Validate competitor scraping configuration',
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument('--config', '-c', default='competitors.json',
                        help='Path to configuration file (default: competitors.json)')
    parser.add_argument('--verbose', '-v', action='store_true',
                        help='Show detailed output')
    parser.add_argument('--fix', action='store_true',
                        help='Attempt to fix common issues')
    
    args = parser.parse_args()
    
    validator = ConfigValidator(args.config)
    is_valid, errors, warnings = validator.run_validation()
    
    if args.fix:
        validator.fix_common_issues()
        if validator.fixed_issues:
            print("\n🔧 Fixed Issues:")
            for issue in validator.fixed_issues:
                print(f"  • {issue}")
            print()
        # Re-validate after fixes
        validator.errors = []
        validator.warnings = []
        is_valid, errors, warnings = validator.run_validation()
    
    print(validator.generate_report(verbose=args.verbose))
    
    # Exit with error code if validation failed
    if not is_valid:
        exit(1)


if __name__ == "__main__":
    main()
