# ProxyFlow Containers

ProxyFlow Containers é uma extensão Firefox criada por **Kádimo** para controlar proxies por contexto de forma granular e poderosa.

## Recursos

- Proxy por Container do Firefox.
- Proxy para abas sem container.
- Proxy para janela privada.
- Regras por site, domínio, subdomínio ou URL.
- Modos: conexão direta, proxy manual, bloquear ou usar Firefox.
- Suporte a SOCKS5, SOCKS4, HTTP e HTTPS.
- Teste manual de proxy com resultado visual (velocidade + IP + país).
- **24+ fontes de proxies públicos gratuitos** de múltiplos provedores.
- Busca e teste em lote com concorrência configurável.
- **Importação de proxies via arquivo .txt** com detecção e formatação automática.
- Salvamento automático dos proxies mais rápidos que carregarem HTTPS.
- Preview dos proxies detectados antes de testar.
- Preferências avançadas: DNS pelo proxy SOCKS e bloqueio de proxy inválido.
- Importação e exportação das configurações em JSON.
- **Interface com 3 abas**: Configurações, Tutorial e Sobre.
- Popup com status do proxy da aba atual.

## Fontes de proxies gratuitas incluídas

| Provedor         | Protocolos              |
|------------------|-------------------------|
| ProxyScrape      | SOCKS5, SOCKS4, HTTP, HTTPS |
| TheSpeedX        | SOCKS5, SOCKS4, HTTP    |
| Monosans         | SOCKS5, SOCKS4, HTTP    |
| ShiftyTR         | SOCKS5, SOCKS4, HTTP    |
| Hookzof          | SOCKS5                  |
| RoosterKid       | SOCKS5, SOCKS4, HTTP    |
| Zloi             | SOCKS5, SOCKS4, HTTP    |
| ProxyScan.io     | SOCKS5, SOCKS4, HTTP    |

## Importar proxies de arquivo .txt

A extensão aceita listas no formato:
```
1.2.3.4:1080
socks5://5.6.7.8:1080
http://9.10.11.12:8080
socks4://13.14.15.16:4145
```

Cada linha é normalizada automaticamente para o formato correto. Duplicatas são removidas.

## Requisitos

- Firefox 109 ou superior.

## Observação sobre proxies públicos

Proxies públicos são instáveis e podem ser inseguros. Use apenas para testes ou navegação sem dados sensíveis. Para login, banco, e-mail, WhatsApp Web ou sistemas internos, use proxy privado/confiável.

## Privacidade

As configurações são salvas localmente no Firefox. A extensão não coleta histórico, senhas, cookies, formulários ou conteúdo de páginas.

## Changelog

### v1.2.1
- Adicionadas 24+ fontes de proxies públicos gratuitos (ProxyScrape, TheSpeedX, Monosans, ShiftyTR, Hookzof, RoosterKid, Zloi, ProxyScan.io).
- Importação de proxies via arquivo .txt com detecção automática de protocolo e preview.
- Interface redesenhada com 3 abas: Configurações, Tutorial e Sobre.
- Preferências avançadas com toggle switches (DNS pelo proxy, bloqueio de proxy inválido).
- Popup melhorado com status atual do proxy da aba ativa.
- Créditos ao criador Kádimo + endereço Bitcoin para doações.
- Melhorias de acessibilidade: aria-live, role="status", aria-label, for/id em labels.
- Background marcado como persistent: false para melhor performance.
- Versão mínima do Firefox atualizada para 109.
