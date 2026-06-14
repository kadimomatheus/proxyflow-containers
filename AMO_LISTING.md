# ProxyFlow Containers

Controle proxies por Container do Firefox, abas sem container, janela privada e regras por site.

ProxyFlow Containers permite escolher como cada contexto do Firefox deve se conectar: conexão direta, proxy manual, bloqueio ou configurações nativas do Firefox.

## Principais recursos

- Proxy por Container do Firefox.
- Proxy para abas normais sem container.
- Proxy para janelas privadas.
- Regras por site, domínio, subdomínio ou URL.
- Suporte a SOCKS5, SOCKS4, HTTP e HTTPS.
- Teste manual de proxy com resultado visual.
- Busca de proxies públicos pela ProxyScrape.
- Teste em lote para encontrar proxies que carregam HTTPS.
- Salvamento automático dos proxies mais rápidos.
- Importação e exportação das configurações em JSON.
- Preferências avançadas: resolução de DNS pelo proxy (SOCKS) e bloqueio automático ao usar proxy inválido.
- Popup com status do proxy da aba atual.

## Como funciona

Você define regras por contexto ou por site. Quando uma página é aberta, a extensão decide se aquela requisição deve usar proxy, conexão direta, bloqueio ou configurações do Firefox.

As regras por site têm prioridade sobre as regras por container.

## Privacidade

A extensão não coleta histórico, senhas, cookies, formulários ou conteúdo das páginas. As configurações ficam salvas localmente no Firefox.

Quando o usuário clica em testar ou buscar proxies rápidos, a extensão faz requisições temporárias para consultar a lista pública da ProxyScrape e validar a conexão HTTPS. Esses dados não são enviados ao desenvolvedor.

## Aviso sobre proxies públicos

Proxies públicos podem ser lentos, instáveis ou inseguros. Use com cuidado e evite acessar contas pessoais, bancos, e-mails ou sistemas sensíveis usando proxies públicos.

Criado por Kadimo.
