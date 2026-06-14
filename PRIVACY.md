# Política de Privacidade — ProxyFlow Containers

ProxyFlow Containers foi criada para controlar o uso de proxies no Firefox por container, aba sem container, janela privada e regras por site.

## Dados que a extensão não coleta

A extensão não coleta, não vende e não envia ao desenvolvedor:

- histórico de navegação;
- senhas;
- cookies;
- conteúdo de páginas;
- formulários preenchidos;
- dados pessoais;
- lista de sites acessados;
- lista de proxies configurados pelo usuário.

## Dados armazenados localmente

A extensão salva localmente no Firefox:

- configurações de proxy;
- regras por site;
- proxies rápidos salvos pelo usuário;
- preferências da extensão.

Esses dados ficam no armazenamento local da extensão no navegador.

## Requisições externas

A extensão pode fazer requisições externas somente quando o usuário usa funções de teste ou busca:

1. ProxyScrape: para obter uma lista pública de proxies.
2. Cloudflare trace: para verificar IP de saída durante o teste.
3. Example.com: para validar se o proxy consegue carregar uma página HTTPS simples.

Essas requisições são usadas apenas para testar conexão e velocidade. O desenvolvedor não recebe esses dados.

## Proxies públicos

Proxies públicos são fornecidos por terceiros e podem ser instáveis ou inseguros. A extensão apenas testa e organiza os resultados. O uso de proxies públicos é responsabilidade do usuário.

## Autor

Criado por Kadimo.
