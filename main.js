#!/usr/bin/env node
/**
 * Z-One 安全命令行调用工具
 * 
 * 功能:
 * 1. 安全执行系统命令 (使用 child_process.spawn)
 * 2. 支持命令参数
 * 3. 输出捕获和展示
 * 4. 错误处理
 * 5. 基本日志记录
 * 
 * @author Z-One Team
 * @version 1.0.0
 * @date 2026-03-15
 */

const { spawn } = require('child_process');
const { join, resolve } = require('path');
const fs = require('fs');
const os = require('os');

// ==================== 配置 ====================
const CONFIG = {
  defaultTimeout: 30000,      // 默认超时时间 30 秒
  maxTimeout: 300000,         // 最大超时时间 300 秒
  maxOutputSize: 1024 * 1024, // 最大输出大小 1MB
  historyFile: '.command_history.json',
  logLevel: 'INFO',
};

// ==================== 常量定义 ====================
const CommandErrorType = {
  COMMAND_NOT_FOUND: 'COMMAND_NOT_FOUND',
  INVALID_INPUT: 'INVALID_INPUT',
  TIMEOUT: 'TIMEOUT',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  SECURITY_VIOLATION: 'SECURITY_VIOLATION',
  RESOURCE_LIMIT: 'RESOURCE_LIMIT',
  UNKNOWN: 'UNKNOWN',
};

// 危险字符正则表达式 (命令注入防护)
const DANGEROUS_PATTERNS = [
  /\$\{/,           // 变量替换
  /\|/,             // 管道符
  /;/,              // 命令分隔符
  /`/,              // 反引号
  />&/,             // 重定向
  /<</,             // 输入重定向
  /\n/,             // 换行符
  /&>/,             // 追加重定向
];

// 黑名单命令
const BLACKLIST_COMMANDS = [
  'rm', 'mkfs', 'dd', 'chmod', 'chown', 
  'sudo', 'passwd', 'useradd', 'usermod',
  '/bin/rm', '/usr/bin/rm', 'dd'
];

// ==================== 日志记录器 ====================
class CommandLogger {
  constructor(historyFile = CONFIG.historyFile) {
    this.historyFile = historyFile;
    this.history = this.loadHistory();
  }

  loadHistory() {
    try {
      if (fs.existsSync(this.historyFile)) {
        const data = fs.readFileSync(this.historyFile, 'utf-8');
        return JSON.parse(data);
      }
    } catch (err) {
      this.log('DEBUG', `无法读取历史记录文件：${err.message}`);
    }
    return { commands: [] };
  }

  saveHistory() {
    try {
      fs.writeFileSync(this.historyFile, JSON.stringify(this.history, null, 2));
    } catch (err) {
      this.log('WARN', `无法保存历史记录：${err.message}`);
    }
  }

  generateId() {
    return `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  log(level, message) {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level}]`;
    
    if (level === 'DEBUG' && CONFIG.logLevel !== 'DEBUG') return;
    
    const colors = {
      DEBUG: '\x1b[36m',    // 青色
      INFO: '\x1b[32m',     // 绿色
      WARN: '\x1b[33m',     // 黄色
      ERROR: '\x1b[31m',    // 红色
      CRITICAL: '\x1b[35m', // 紫色
    };
    const reset = '\x1b[0m';
    
    console.log(`${colors[level] || reset}${prefix}${reset} ${message}`);
  }

  recordCommand(command, args, exitCode, stdout, stderr, duration, status) {
    const record = {
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      command: command,
      args: args,
      exitCode: exitCode,
      stdout: stdout.substring(0, 1000), // 限制输出长度
      stderr: stderr.substring(0, 1000),
      duration: duration,
      status: status,
    };

    this.history.commands.unshift(record);
    
    // 保持历史记录不超过 100 条
    if (this.history.commands.length > 100) {
      this.history.commands = this.history.commands.slice(0, 100);
    }
    
    this.saveHistory();
    return record;
  }

  getHistory(limit = 10) {
    return this.history.commands.slice(0, limit);
  }

  clearHistory() {
    this.history = { commands: [] };
    this.saveHistory();
  }
}

// ==================== 输入验证器 ====================
class InputValidator {
  static validateCommand(command) {
    if (!command || typeof command !== 'string') {
      return { valid: false, error: '命令不能为空' };
    }

    if (command.length > 256) {
      return { valid: false, error: '命令长度超过限制' };
    }

    // 检查黑名单
    const baseCommand = command.split(/[\s/\\]/)[0].toLowerCase();
    if (BLACKLIST_COMMANDS.includes(baseCommand)) {
      return { valid: false, error: `命令 "${command}" 已被安全策略禁用` };
    }

    return { valid: true };
  }

  static validateArg(arg) {
    if (!arg) {
      return { valid: true }; // 空参数允许
    }

    if (typeof arg !== 'string') {
      return { valid: false, error: '参数必须是字符串' };
    }

    if (arg.length > 1024) {
      return { valid: false, error: '参数长度超过限制' };
    }

    // 检查危险字符
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(arg)) {
        return { valid: false, error: '参数包含危险字符，可能存在安全风险' };
      }
    }

    return { valid: true };
  }
}

// ==================== 命令执行器 ====================
class CommandExecutor {
  constructor(logger) {
    this.logger = logger;
  }

  execute(command, args = [], options = {}) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const timeout = Math.min(options.timeout || CONFIG.defaultTimeout, CONFIG.maxTimeout);

      this.logger.log('INFO', `执行命令：${command} ${args.join(' ')}`);

      // 输入验证
      const commandValidation = InputValidator.validateCommand(command);
      if (!commandValidation.valid) {
        const error = this.createError(CommandErrorType.SECURITY_VIOLATION, commandValidation.error);
        return reject(error);
      }

      for (const arg of args) {
        const argValidation = InputValidator.validateArg(arg);
        if (!argValidation.valid) {
          const error = this.createError(CommandErrorType.INVALID_INPUT, argValidation.error);
          return reject(error);
        }
      }

      // 设置默认选项
      const spawnOptions = {
        cwd: options.cwd || process.cwd(),
        env: process.env,
        ...options,
      };

      // 启动进程
      const process = spawn(command, args, spawnOptions);
      let stdout = '';
      let stderr = '';
      let timeoutId = null;

      // 超时控制
      timeoutId = setTimeout(() => {
        if (process && !process.killed) {
          process.kill('SIGTERM');
          const error = this.createError(CommandErrorType.TIMEOUT, `命令执行超时 (${timeout}ms)`);
          return reject(error);
        }
      }, timeout);

      // 收集标准输出
      process.stdout.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        
        // 输出大小限制检查
        if (stdout.length > CONFIG.maxOutputSize) {
          if (process && !process.killed) {
            process.kill('SIGTERM');
          }
          const error = this.createError(CommandErrorType.RESOURCE_LIMIT, '输出超过大小限制');
          return reject(error);
        }
        
        // 实时输出 (如果不静默)
        if (!options.silent) {
          process.stdout.write(output);
        }
      });

      // 收集错误输出
      process.stderr.on('data', (data) => {
        const output = data.toString();
        stderr += output;
        
        if (!options.silent) {
          process.stderr.write(output);
        }
      });

      // 进程结束
      process.on('exit', (code, signal) => {
        clearTimeout(timeoutId);
        const duration = Date.now() - startTime;

        const status = code === 0 ? 'success' : 'failed';
        this.logger.log('INFO', `命令执行完成，耗时：${duration}ms，退出码：${code}`);
        
        // 记录日志
        this.logger.recordCommand(command, args, code || -1, stdout, stderr, duration, status);

        resolve({
          exitCode: code,
          signal: signal,
          stdout: stdout,
          stderr: stderr,
          duration: duration,
          status: status,
        });
      });

      // 进程错误
      process.on('error', (err) => {
        clearTimeout(timeoutId);
        const duration = Date.now() - startTime;
        
        let errorType = CommandErrorType.UNKNOWN;
        let errorMessage = err.message;

        if (err.code === 'ENOENT') {
          errorType = CommandErrorType.COMMAND_NOT_FOUND;
          errorMessage = `命令 "${command}" 不存在，请确认命令名称或检查 PATH 环境变量`;
        } else if (err.code === 'EACCES') {
          errorType = CommandErrorType.PERMISSION_DENIED;
          errorMessage = `执行 "${command}" 权限不足`;
        }

        this.logger.log('ERROR', `命令执行失败：${errorMessage}`);
        this.logger.recordCommand(command, args, -1, stdout, stderr, duration, 'error');

        const error = this.createError(errorType, errorMessage, err);
        reject(error);
      });
    });
  }

  createError(type, message, originalError = null) {
    const error = new Error(message);
    error.code = type;
    error.message = message;
    error.details = originalError ? originalError.message : message;
    error.suggestedAction = this.getSuggestion(type);
    return error;
  }

  getSuggestion(errorType) {
    const suggestions = {
      [CommandErrorType.COMMAND_NOT_FOUND]: '请确认命令是否正确，或检查 PATH 环境变量',
      [CommandErrorType.INVALID_INPUT]: '请检查命令和参数格式，避免使用特殊字符',
      [CommandErrorType.TIMEOUT]: '增加 --timeout 参数或优化命令执行时间',
      [CommandErrorType.PERMISSION_DENIED]: '使用合适权限执行，或检查文件权限',
      [CommandErrorType.SECURITY_VIOLATION]: '该命令被安全策略阻止，请联系管理员',
      [CommandErrorType.RESOURCE_LIMIT]: '减少输出量或分批执行',
      [CommandErrorType.UNKNOWN]: '检查系统日志或重新执行',
    };
    return suggestions[errorType] || '请检查错误详情';
  }
}

// ==================== CLI 解析器 ====================
class CLIParser {
  static parse(args) {
    const result = {
      command: null,
      args: [],
      options: {},
    };

    let inArgs = false;

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];

      if (arg === '--help' || arg === '-h') {
        return { action: 'help' };
      }

      if (arg === '--test') {
        return { action: 'test' };
      }

      if (arg === '--timeout') {
        result.options.timeout = parseInt(args[++i]) * 1000;
        continue;
      }

      if (arg === '--cwd') {
        result.options.cwd = resolve(args[++i]);
        continue;
      }

      if (arg === '--verbose') {
        CONFIG.logLevel = 'DEBUG';
        continue;
      }

      if (arg === '--silent') {
        result.options.silent = true;
        continue;
      }

      if (arg === 'help') {
        return { action: 'help' };
      }

      if (arg === 'history') {
        return { action: 'history' };
      }

      if (arg === 'clean') {
        return { action: 'clean' };
      }

      if (arg === 'run' || arg === 'exec') {
        inArgs = true;
        continue;
      }

      if (!result.command && inArgs) {
        result.command = arg;
      } else if (inArgs) {
        result.args.push(arg);
      } else if (!result.command) {
        result.command = arg;
        inArgs = true;
      } else {
        result.args.push(arg);
      }
    }

    return { action: 'run', ...result };
  }
}

// ==================== 帮助信息 ====================
function showHelp() {
  console.log(`
${'='.repeat(60)}
  Z-One 安全命令行调用工具 v1.0.0
${'='.repeat(60)}

用法:
  node main.js [选项] <命令> [参数...]
  node main.js run <命令> [参数...]

选项:
  --help, -h          显示此帮助信息
  --timeout <秒>      命令超时时间 (默认：30 秒，最大：300 秒)
  --cwd <目录>        工作目录 (默认：当前目录)
  --verbose           详细输出模式
  --silent            静默模式，减少输出

子命令:
  run <命令>          执行命令
  history             查看命令历史记录
  clean               清空历史记录
  help                显示帮助信息
  --test              运行内置测试

示例:
  node main.js ls -la
  node main.js run "pwd"
  node main.js run "find" "." "-name" "*.js"
  node main.js run "sleep" "5" --timeout 10
  node main.js --timeout 60 ls -la /tmp

安全特性:
  ✓ 使用 spawn 而非 exec，避免命令注入
  ✓ 危险字符过滤和黑名单验证
  ✓ 超时控制和输出大小限制
  ✓ 完整的执行日志和审计追踪

相关文档:
  - 设计文档：cli_tool_design.md
  - Node.js child_process: https://nodejs.org/docs/latest/api/child_process.html

${'='.repeat(60)}
  作者：Z-One Team | 创建日期：2026-03-15
${'='.repeat(60)}
`);
}

// ==================== 测试模式 ====================
async function runTests(logger, executor) {
  console.log('\n开始运行内置测试...\n');
  
  const tests = [
    { name: '测试 1: echo 命令', command: 'echo', args: ['Hello, World!'] },
    { name: '测试 2: pwd 命令', command: 'pwd', args: [] },
    { name: '测试 3: ls 命令', command: 'ls', args: ['-la'] },
    { name: '测试 4: date 命令', command: 'date', args: [] },
    { name: '测试 5: node --version', command: 'node', args: ['--version'] },
    { name: '测试 6: 无效命令', command: 'invalid_command_xyz_12345', args: [], expectError: true },
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      console.log(`\n${test.name}`);
      console.log(`命令：${test.command} ${test.args.join(' ')}`);
      
      const result = await executor.execute(test.command, test.args, { timeout: 5000 });
      
      if (test.expectError) {
        console.log('❌ 期望失败但成功');
        failed++;
      } else {
        console.log(`✓ 成功 - 退出码：${result.exitCode}, 耗时：${result.duration}ms`);
        passed++;
      }
    } catch (err) {
      if (test.expectError) {
        console.log(`✓ 正确捕获错误：${err.code}`);
        passed++;
      } else {
        console.log(`❌ 失败：${err.message}`);
        failed++;
      }
    }
  }

  console.log(`\n${'='.repeat(40)}`);
  console.log(`测试完成：${passed}通过，${failed}失败`);
  console.log('='.repeat(40) + '\n');

  return { passed, failed };
}

// ==================== 错误处理 ====================
function handleError(error) {
  const colors = { reset: '\x1b[0m', red: '\x1b[31m', yellow: '\x1b[33m' };
  
  console.error(`\n${'='.repeat(50)}`);
  console.error(`${colors.red}✗ 错误类型：${error.code}${colors.reset}`);
  console.error(`${colors.red}✗ 错误信息：${error.message}${colors.reset}`);
  
  if (error.suggestedAction) {
    console.error(`${colors.yellow}💡 建议：${error.suggestedAction}${colors.reset}`);
  }
  
  if (error.details && error.details !== error.message) {
    console.error(`${colors.yellow}📋 详情：${error.details}${colors.reset}`);
  }
  
  console.error('='.repeat(50) + '\n');
  process.exit(1);
}

// ==================== 显示历史记录 ====================
function showHistory(logger) {
  const history = logger.getHistory(20);
  
  console.log('\n最近的命令历史记录:');
  console.log('='.repeat(70));
  
  if (history.length === 0) {
    console.log('  暂无历史记录');
  } else {
    history.forEach((record, index) => {
      const statusColor = record.status === 'success' ? '\x1b[32m' : '\x1b[31m';
      console.log(`\n  ${index + 1}. [${record.timestamp.split('T')[1].split('.')[0]}]`);
      console.log(`     命令：${record.command} ${record.args.join(' ')}`);
      console.log(`     状态：${statusColor}${record.status}\x1b[0m, 退出码：${record.exitCode}, 耗时：${record.duration}ms`);
    });
  }
  console.log('\n' + '='.repeat(70));
  console.log(`提示：使用 "node main.js clean" 清空历史记录`);
}

// ==================== 主函数 ====================
async function main() {
  const args = process.argv.slice(2);
  const parser = CLIParser.parse(args);
  
  const logger = new CommandLogger();
  const executor = new CommandExecutor(logger);

  logger.log('INFO', 'Z-One CLI Tool 启动');

  try {
    switch (parser.action) {
      case 'help':
        showHelp();
        break;

      case 'history':
        showHistory(logger);
        break;

      case 'clean':
        logger.clearHistory();
        console.log('\n✓ 历史记录已清空\n');
        break;

      case 'test':
        await runTests(logger, executor);
        break;

      case 'run':
        if (!parser.command) {
          console.error('\n错误：请指定要执行的命令');
          console.log('使用 "node main.js --help" 查看帮助信息\n');
          process.exit(1);
        }

        console.log(`\n执行命令：${parser.command} ${parser.args.join(' ')}\n`);
        const result = await executor.execute(parser.command, parser.args, parser.options);
        
        const statusColor = result.status === 'success' ? '\x1b[32m' : '\x1b[31m';
        console.log(`\n${'='.repeat(40)}`);
        console.log(`✓ 执行完成`);
        console.log(`退出码：${result.exitCode}`);
        console.log(`耗时：${result.duration}ms`);
        console.log(`状态：${statusColor}${result.status}\x1b[0m`);
        console.log('='.repeat(40) + '\n');
        
        process.exit(result.exitCode || 0);
        break;

      default:
        showHelp();
    }
  } catch (err) {
    handleError(err);
  }
}

// 启动主程序
main();
