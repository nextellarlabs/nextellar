# PowerShell completion for nextellar
# To install: Add to your PowerShell profile ($PROFILE)
# Example: Add-Content $PROFILE (Get-Content path\to\nextellar-completion.ps1)

Register-ArgumentCompleter -Native -CommandName nextellar -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)

    $commands = @(
        'doctor',
        'status',
        'templates',
        'init',
        'add',
        'telemetry',
        'upgrade',
        'deploy',
        'clean'
    )

    $templates = @('default', 'minimal', 'defi', 'marketplace', 'nft', 'dao', 'payments')
    $features = @('useWallet', 'useStellarAccount', 'useStellarBalance', 'useStellarPayment', 'useSorobanContract', 'useAnchorAuth', 'WalletButton', 'AccountInfo', 'PaymentForm', 'TokenBalance')
    $packageManagers = @('npm', 'yarn', 'pnpm', 'bun')
    $wallets = @('freighter', 'xbull', 'albedo', 'lobstr')

    $ast = $commandAst.ToString()
    $tokens = $ast -split '\s+'

    # If we're completing the first argument (command or project name)
    if ($tokens.Count -le 2) {
        $commands | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
            [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
        }
        return
    }

    $subcommand = $tokens[1]

    switch ($subcommand) {
        'add' {
            if ($wordToComplete -like '--*') {
                @('--list', '--force', '--skip-install', '--package-manager', '--dry-run', '--verbose', '--debug') |
                    Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                        [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterName', $_)
                    }
            }
            elseif ($tokens[-2] -eq '--package-manager') {
                $packageManagers | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
                }
            }
            else {
                $features | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
                }
            }
        }
        'templates' {
            if ($wordToComplete -like '--*') {
                @('--json') | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterName', $_)
                }
            }
            else {
                $templates | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
                }
            }
        }
        'telemetry' {
            @('status', 'enable', 'disable') | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
            }
        }
        'doctor' {
            @('--json', '--fix', '--horizon-url', '--soroban-url') |
                Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterName', $_)
                }
        }
        'status' {
            @('--json') | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterName', $_)
            }
        }
        'init' {
            @('-d', '--defaults') | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterName', $_)
            }
        }
        'upgrade' {
            @('--dry-run', '--check', '--diff', '--yes', '--verbose', '--debug') |
                Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterName', $_)
                }
        }
        'deploy' {
            @('--dry-run', '--size-threshold', '--verbose', '--debug') |
                Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterName', $_)
                }
        }
        default {
            # Main command options
            if ($tokens[-2] -eq '--template') {
                $templates | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
                }
            }
            elseif ($tokens[-2] -eq '--package-manager') {
                $packageManagers | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
                }
            }
            elseif ($tokens[-2] -in @('-w', '--wallets')) {
                $wallets | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
                }
            }
            elseif ($wordToComplete -like '--*' -or $wordToComplete -like '-*') {
                @('-t', '--typescript', '-j', '--javascript', '--template', '--horizon-url', '--soroban-url',
                  '-w', '--wallets', '-d', '--defaults', '-y', '--yes', '--skip-install', '--package-manager',
                  '-c', '--with-contracts', '--force', '--no-git', '--git-init', '--install-timeout',
                  '--no-telemetry', '--verbose', '--debug', '-v', '--version', '-h', '--help') |
                    Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
                        [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterName', $_)
                    }
            }
        }
    }
}
