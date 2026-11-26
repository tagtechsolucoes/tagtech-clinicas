# Lê o .env sem executá-lo: "Nome <email>", parênteses e espaços não quebram os scripts.
# Uso: . ./env.sh && carregar_env .env
carregar_env() {
  local linha chave valor
  while IFS= read -r linha || [ -n "$linha" ]; do
    linha=${linha%$'\r'}
    case "$linha" in '' | \#*) continue ;; esac
    chave=${linha%%=*}
    valor=${linha#*=}
    case "$chave" in *[!A-Za-z0-9_]* | '') continue ;; esac
    case "$valor" in
      \'*\') valor=${valor:1:${#valor}-2} ;;
      \"*\") valor=${valor:1:${#valor}-2} ;;
    esac
    export "$chave=$valor"
  done < "$1"
}
