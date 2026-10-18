# bash completion for nextellar
# To install: source this file or add it to your .bashrc

_nextellar_completions() {
  local cur prev commands
  COMPREPLY=()
  cur="${COMP_WORDS[COMP_CWORD]}"
  prev="${COMP_WORDS[COMP_CWORD-1]}"
  commands="doctor status templates init add telemetry upgrade deploy clean"

  # Complete commands
  if [[ ${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "$commands" -- "$cur") )
    return 0
  fi

  # Get the subcommand
  local subcommand="${COMP_WORDS[1]}"

  case "$subcommand" in
    add)
      case "$prev" in
        add)
          COMPREPLY=( $(compgen -W "useWallet useStellarAccount useStellarBalance useStellarPayment useSorobanContract useAnchorAuth WalletButton AccountInfo PaymentForm TokenBalance --list --force --skip-install --package-manager --dry-run --verbose --debug" -- "$cur") )
          ;;
        --package-manager)
          COMPREPLY=( $(compgen -W "npm yarn pnpm bun" -- "$cur") )
          ;;
        *)
          COMPREPLY=( $(compgen -W "--list --force --skip-install --package-manager --dry-run --verbose --debug" -- "$cur") )
          ;;
      esac
      ;;
    templates)
      case "$prev" in
        templates)
          COMPREPLY=( $(compgen -W "default minimal defi marketplace nft dao payments --json" -- "$cur") )
          ;;
        *)
          COMPREPLY=( $(compgen -W "--json" -- "$cur") )
          ;;
      esac
      ;;
    telemetry)
      COMPREPLY=( $(compgen -W "status enable disable" -- "$cur") )
      ;;
    doctor)
      COMPREPLY=( $(compgen -W "--json --fix --horizon-url --soroban-url" -- "$cur") )
      ;;
    status)
      COMPREPLY=( $(compgen -W "--json" -- "$cur") )
      ;;
    init)
      COMPREPLY=( $(compgen -W "--defaults" -- "$cur") )
      ;;
    upgrade)
      COMPREPLY=( $(compgen -W "--dry-run --check --diff --yes --verbose --debug" -- "$cur") )
      ;;
    deploy)
      COMPREPLY=( $(compgen -W "--dry-run --size-threshold --verbose --debug" -- "$cur") )
      ;;
    clean)
      # No options for clean
      ;;
    *)
      # Main command options when creating a new project
      case "$prev" in
        --template)
          COMPREPLY=( $(compgen -W "default minimal defi marketplace nft dao payments" -- "$cur") )
          ;;
        --package-manager)
          COMPREPLY=( $(compgen -W "npm yarn pnpm bun" -- "$cur") )
          ;;
        --wallets|-w)
          COMPREPLY=( $(compgen -W "freighter xbull albedo lobstr" -- "$cur") )
          ;;
        *)
          COMPREPLY=( $(compgen -W "-t --typescript -j --javascript --template --horizon-url --soroban-url -w --wallets -d --defaults -y --yes --skip-install --package-manager -c --with-contracts --force --no-git --git-init --install-timeout --no-telemetry --verbose --debug -v --version -h --help" -- "$cur") )
          ;;
      esac
      ;;
  esac

  return 0
}

complete -F _nextellar_completions nextellar
