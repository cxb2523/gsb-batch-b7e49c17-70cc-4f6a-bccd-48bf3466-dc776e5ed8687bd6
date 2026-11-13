import urllib.request
import urllib.parse
import urllib.error
import json
import logging
import os
import time


# Nomes dos arquivos de dados, centralizados para facilitar os testes
# (os testes trocam o diretório de trabalho, então tudo é relativo a ele).
ARQUIVO_JOGOS_MONITORADOS = "jogos_monitorados.json"
ARQUIVO_HISTORICO = "historico.json"
ARQUIVO_CONFIG_TELEGRAM = "config_telegram.json"
ARQUIVO_OFFSET_TELEGRAM = "telegram_offset.json"

logging.basicConfig(
    filename="radar.log",
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    encoding="utf-8"
)


def _consultar_steam(app_id):
    """
    Faz a chamada à API appdetails da Steam e devolve o objeto cru do
    app_id (o dicionário associado à chave str(app_id) na resposta).

    É o ponto único de rede das funções buscar_preco() e
    buscar_nome_jogo(). Devolve None quando a resposta não traz o
    app_id. Lança as exceções de rede/IO/JSON para quem chamou, que
    decide como registrar e seguir adiante.
    """
    parametros_precos = {"appids": app_id, "cc": "br", "l": "portuguese"}
    query = urllib.parse.urlencode(parametros_precos)
    resposta = urllib.request.urlopen(
        "https://store.steampowered.com/api/appdetails?" + query
    )
    try:
        conteudo_bruto = resposta.read()
    finally:
        fechar = getattr(resposta, "close", None)
        if callable(fechar):
            fechar()
    decodificado = conteudo_bruto.decode("utf-8")
    texto = json.loads(decodificado)
    return texto.get(str(app_id), None)


def buscar_preco(app_id):
    """
    Busca o preço atual de um jogo na Steam, dado seu app_id.

    Usa a API pública appdetails da Steam. Só devolve um resultado
    quando o jogo tem preço de fato (não é gratuito e não está
    indisponível/sem dados) — nesses casos, devolve None.

    Tolerante a falhas: erro de rede, resposta que não seja JSON
    válido, ausência do app_id na resposta ou ausência de "data" são
    registrados no log e resultam em None, sem lançar exceção para
    fora da função. Assim, um app_id problemático não interrompe a
    varredura dos demais jogos.

    Use esta função quando precisar do preço para comparação/histórico.
    Se só precisar confirmar que um app_id existe e pegar o nome do
    jogo (mesmo sem preço, como jogos grátis), use buscar_nome_jogo().
    """
    try:
        jogo = _consultar_steam(app_id)
    except urllib.error.URLError as erro:
        logging.warning(
            f"Falha de rede ao buscar preço do app_id {app_id}: {erro}"
        )
        return None
    except (OSError, TimeoutError) as erro:
        logging.warning(
            f"Erro de conexão/leitura ao buscar preço do app_id {app_id}: {erro}"
        )
        return None
    except json.JSONDecodeError as erro:
        logging.warning(
            f"Resposta da Steam não é um JSON válido para o app_id {app_id}: {erro}"
        )
        return None
    except Exception as erro:  # noqa: BLE001 - varredura precisa sobreviver a qualquer falha
        logging.error(
            f"Erro inesperado ao buscar preço do app_id {app_id}: {erro}"
        )
        return None

    if jogo is None:
        logging.warning(
            f"Não foi possível obter dados da Steam para o app_id {app_id} "
            "(app_id ausente na resposta)."
        )
        return None

    if not isinstance(jogo, dict):
        logging.warning(
            f"Resposta da Steam para o app_id {app_id} veio em formato inesperado."
        )
        return None

    dados = jogo.get("data")
    if dados is None:
        logging.warning(
            f"Steam retornou sem 'data' para o app_id {app_id}; "
            "preço indisponível nesta rodada."
        )
        return None

    if not isinstance(dados, dict):
        logging.warning(
            f"Campo 'data' da Steam para o app_id {app_id} veio em formato inesperado."
        )
        return None

    nome = dados.get("name")
    preco = dados.get("price_overview")
    if preco is None:
        logging.warning(
            f"Sem preço disponível ou o jogo é gratuito (app_id {app_id})."
        )
        return None

    valor_final = preco.get("final")
    if not isinstance(valor_final, (int, float)) or isinstance(valor_final, bool):
        logging.warning(
            f"price_overview do app_id {app_id} não trouxe um valor final numérico."
        )
        return None

    valor = valor_final / 100
    jogo_atual = {"jogo": nome, "preco": valor}
    return jogo_atual


def buscar_nome_jogo(app_id):
    """
    Busca apenas o nome de um jogo na Steam, dado seu app_id.

    Diferente de buscar_preco(), não exige que o jogo tenha preço —
    funciona também para jogos grátis ou sem price_overview. Só
    devolve None se o app_id não existir na Steam, a resposta vier
    sem dados, ou ocorrer qualquer falha de rede/JSON. Nunca lança
    exceção, para um comando /add não derrubar o processamento das
    demais mensagens.

    Use esta função para validar/nomear um app_id ao adicioná-lo à
    lista de jogos monitorados (menu ou comandos do Telegram).
    """
    try:
        jogo = _consultar_steam(app_id)
    except urllib.error.URLError as erro:
        logging.warning(
            f"Falha de rede ao buscar nome do app_id {app_id}: {erro}"
        )
        return None
    except (OSError, TimeoutError) as erro:
        logging.warning(
            f"Erro de conexão/leitura ao buscar nome do app_id {app_id}: {erro}"
        )
        return None
    except json.JSONDecodeError as erro:
        logging.warning(
            f"Resposta da Steam não é um JSON válido ao buscar nome do app_id "
            f"{app_id}: {erro}"
        )
        return None
    except Exception as erro:  # noqa: BLE001 - comandos precisam sobreviver a qualquer falha
        logging.error(
            f"Erro inesperado ao buscar nome do app_id {app_id}: {erro}"
        )
        return None

    if not isinstance(jogo, dict):
        return None
    dados = jogo.get("data")
    if not isinstance(dados, dict):
        return None
    nome = dados.get("name")
    return nome


def carregar_jogos_monitorados():
    """
    Lê a lista de jogos monitorados de jogos_monitorados.json.

    Cada item é um dicionário {"app_id": ..., "nome": ...}. Se o
    arquivo ainda não existir (primeira execução), devolve lista vazia.
    """
    try:
        with open(ARQUIVO_JOGOS_MONITORADOS, "r", encoding="utf-8") as arquivo:
            jogos_monitorados = json.load(arquivo)
    except FileNotFoundError:
        logging.warning(
            "Arquivo de configuração não encontrado, usando lista vazia."
        )
        jogos_monitorados = []
    return jogos_monitorados


def _preservar_arquivo_corrompido(caminho):
    """
    Renomeia um arquivo de dados corrompido para um nome de backup,
    preservando o conteúdo original em vez de sobrescrevê-lo.

    Usado quando historico.json não pode ser interpretado: o backup
    mantém os dados crus para recuperação manual, e a rodada segue com
    um histórico vazio. Devolve o caminho do backup criado (ou None se
    não for possível fazer o backup).
    """
    for tentativa in range(1, 100):
        backup = f"{caminho}.corrompido.{tentativa}"
        if not os.path.exists(backup):
            try:
                os.replace(caminho, backup)
                return backup
            except OSError as erro:
                logging.error(
                    f"Não foi possível mover o arquivo corrompido {caminho} "
                    f"para {backup}: {erro}"
                )
                return None
    logging.error(
        f"Não foi possível criar um backup do arquivo corrompido {caminho}."
    )
    return None


def carregar_historico():
    """
    Lê o histórico de preços de historico.json.

    Formato: {"Nome do Jogo": [preco1, preco2, ...]}, com um preço
    por execução em que o jogo teve preço disponível.

    Tolerante a dados corrompidos:
      - arquivo inexistente -> histórico vazio;
      - conteúdo que não seja JSON válido, ou JSON cujo topo não seja
        um objeto (dicionário) -> alerta no log, o arquivo original é
        preservado como backup (.corrompido.N) e a rodada segue com
        histórico vazio, sem nunca sobrescrever silenciosamente os
        dados originais.
    """
    try:
        with open(ARQUIVO_HISTORICO, "r", encoding="utf-8") as arquivo:
            historico = json.load(arquivo)
    except FileNotFoundError:
        logging.warning(
            f"{ARQUIVO_HISTORICO} não encontrado; iniciando com histórico vazio."
        )
        return {}
    except json.JSONDecodeError as erro:
        logging.error(
            f"{ARQUIVO_HISTORICO} não contém JSON válido ({erro}). "
            "Preservando o arquivo original e seguindo com histórico vazio."
        )
        _preservar_arquivo_corrompido(ARQUIVO_HISTORICO)
        return {}
    except OSError as erro:
        logging.error(
            f"Erro ao ler {ARQUIVO_HISTORICO}: {erro}. "
            "Seguindo com histórico vazio, sem sobrescrever o arquivo."
        )
        return {}

    if not isinstance(historico, dict):
        logging.error(
            f"{ARQUIVO_HISTORICO} tem um valor de nível superior que não é um "
            f"objeto (tipo encontrado: {type(historico).__name__}). "
            "Preservando o arquivo original e seguindo com histórico vazio."
        )
        _preservar_arquivo_corrompido(ARQUIVO_HISTORICO)
        return {}

    return historico


def _historico_do_jogo_valido(historico, nome_jogo):
    """
    Devolve a lista de preços de um jogo somente se ela for uma lista
    de números. Qualquer outro formato (lista com texto, número solto,
    dicionário etc.) é tratado como "sem histórico": emite um alerta
    uma única vez e devolve None.
    """
    if nome_jogo not in historico:
        return None
    lista_precos = historico[nome_jogo]
    if not isinstance(lista_precos, list) or not lista_precos:
        logging.warning(
            f"Histórico de '{nome_jogo}' não é uma lista de preços; "
            "tratando como se não houvesse histórico."
        )
        return None
    for item in lista_precos:
        # bool é subclasse de int em Python, por isso é excluído à parte.
        if isinstance(item, bool) or not isinstance(item, (int, float)):
            logging.warning(
                f"Histórico de '{nome_jogo}' contém valor não numérico ({item!r}); "
                "tratando como se não houvesse histórico."
            )
            return None
    return lista_precos


def buscar_anterior(historico, nome_jogo):
    """
    Devolve o último preço registrado de um jogo no histórico.

    É o preço da execução mais recente antes da atual. Devolve None
    se esse jogo ainda não tiver nenhum registro salvo, ou se o
    histórico salvo para ele estiver em formato inválido.
    """
    lista_precos = _historico_do_jogo_valido(historico, nome_jogo)
    if lista_precos:
        return lista_precos[-1]
    return None


def buscar_menor_preco(historico, nome_jogo):
    """
    Devolve o menor preço já registrado de um jogo no histórico.

    Percorre todo o histórico daquele jogo (não só o último), útil
    para saber se uma queda atual representa o melhor preço de sempre.
    Devolve None se não houver nenhum registro salvo, ou se o
    histórico salvo para ele estiver em formato inválido.
    """
    lista_precos = _historico_do_jogo_valido(historico, nome_jogo)
    if lista_precos:
        return min(lista_precos)
    return None


def carregar_config_telegram():
    """
    Lê o token do bot e o chat_id de config_telegram.json.

    Esse arquivo é local e nunca é versionado (está no .gitignore),
    pois contém credenciais sensíveis.
    """
    with open(ARQUIVO_CONFIG_TELEGRAM, "r", encoding="utf-8") as arquivo:
        config_telegram = json.load(arquivo)
    return config_telegram


def enviar_notificacao(mensagem):
    """
    Envia uma mensagem de texto para o Telegram via sendMessage.

    Usa as credenciais de carregar_config_telegram(). Não trata o
    conteúdo da resposta — só dispara o envio.
    """
    codigo = carregar_config_telegram()
    token = codigo["token"]
    chat_id = codigo["chat_id"]
    url_base = "https://api.telegram.org/bot" + token + "/sendMessage?"
    parametros_mensagem = {"chat_id": chat_id, "text": mensagem}
    query_mensagem = urllib.parse.urlencode(parametros_mensagem)
    url_final = url_base + query_mensagem
    urllib.request.urlopen(url_final)


def comparar_precos(anterior, resultado, menor_preco):
    """
    Compara o preço atual com o último registrado e notifica.

    Só envia notificação no Telegram em caso de queda ou aumento —
    "sem alteração" fica só no log local, para evitar notificar o
    usuário todo dia sem necessidade (silêncio = nada mudou).
    """
    if anterior is not None and resultado["preco"] < anterior:
       enviar_notificacao(f"{resultado['jogo']} teve queda: R$ {anterior} → R$ {resultado['preco']} (menor preço já visto: R$ {menor_preco})")
       logging.info(f"{resultado['jogo']} teve queda: R$ {anterior} → R$ {resultado['preco']} (menor preço já visto: R$ {menor_preco})")
    elif anterior is not None and resultado["preco"] > anterior:
       enviar_notificacao(f"{resultado['jogo']} teve aumento: R$ {anterior} → R$ {resultado['preco']}")
       logging.info(f"{resultado['jogo']} teve aumento: R$ {anterior} → R$ {resultado['preco']}")
    elif anterior is not None:
        logging.info(f"Preço de {resultado['jogo']} sem alteração. Preço atual: R$ {resultado['preco']}")


def salvar_historico(historico):
    """
    Grava o dicionário de histórico em historico.json.

    Devolve True se conseguiu gravar e False caso contrário. Um erro
    de gravação é registrado, mas não lança exceção, para não
    interromper a rodada no seu último passo.
    """
    try:
        with open(ARQUIVO_HISTORICO, "w", encoding="utf-8") as arquivo:
            json.dump(historico, arquivo, ensure_ascii=False, indent=2)
    except OSError as erro:
        logging.error(f"Não foi possível salvar {ARQUIVO_HISTORICO}: {erro}")
        return False
    return True


def rodar_varredura(app_ids, historico):
    """
    Busca o preço de todos os jogos monitorados, compara e notifica.

    Cada jogo é processado de forma isolada: qualquer falha na busca
    de um app_id (rede, JSON inválido, resposta sem 'data' ou sem o
    app_id) apenas gera um aluno no log e a varredura continua pelos
    demais — a exceção nunca sobe para interromper a rodada.

    Para cada jogo com sucesso: compara com o histórico, envia
    notificação se necessário e acumula o novo preço no histórico.
    Inclui uma pausa (time.sleep) entre requisições para reduzir o
    risco de a Steam limitar/bloquear chamadas em sequência rápida.
    O histórico é salvo uma única vez no final. Se nenhum jogo
    retornar preço válido, o histórico existente ainda assim é salvo
    de volta (nenhum dado se perde) e o fato fica registrado no log.

    Devolve um dicionário com as contagens da rodada:
    {"total": N, "sucesso": S, "falha": F}.
    """
    total = len(app_ids)
    sucessos = 0
    falhas = 0

    for jogo_monitorado in app_ids:
        try:
            app_id = jogo_monitorado["app_id"]
        except (TypeError, KeyError):
            logging.error(
                f"Item da lista de monitorados sem 'app_id' foi ignorado: {jogo_monitorado!r}"
            )
            falhas += 1
            continue

        try:
            resultado = buscar_preco(app_id)
        except Exception as erro:  # noqa: BLE001 - defesa extra: nada interrompe a rodada
            logging.error(
                f"Erro inesperado ao processar o app_id {app_id}: {erro}"
            )
            resultado = None

        time.sleep(1)

        if resultado is None:
            falhas += 1
            logging.warning(
                f"app_id {app_id} sem preço válido nesta rodada; "
                "seguindo para os demais jogos."
            )
            continue

        try:
            sucessos += 1
            print(f"{resultado['jogo']}: R$ {resultado['preco']}")
            anterior = buscar_anterior(historico, resultado["jogo"])
            menor_preco = buscar_menor_preco(historico, resultado["jogo"])
            logging.info(f"Anterior encontrado: {anterior}")
            logging.info(f"Menor preço já visto: {menor_preco}")
            try:
                comparar_precos(anterior, resultado, menor_preco)
            except Exception as erro:  # noqa: BLE001 - falha de notificação não impede o histórico
                logging.error(
                    f"Falha ao notificar sobre '{resultado['jogo']}': {erro}"
                )

            # Recupera a lista crua: se estiver corrompida, reinicia a
            # série deste jogo em vez de anexar em cima de lixo.
            serie_existente = historico.get(resultado["jogo"])
            if not isinstance(serie_existente, list) or not serie_existente or any(
                isinstance(item, bool) or not isinstance(item, (int, float))
                for item in serie_existente
            ):
                if resultado["jogo"] in historico:
                    logging.warning(
                        f"Histórico existente de '{resultado['jogo']}' é inválido; "
                        "reiniciando a série deste jogo."
                    )
                historico[resultado["jogo"]] = []
            historico[resultado["jogo"]].append(resultado["preco"])
        except Exception as erro:  # noqa: BLE001 - um jogo problemático não derruba a rodada
            sucessos -= 1
            falhas += 1
            logging.error(
                f"Erro ao processar resultado do app_id {app_id}: {erro}"
            )

    if sucessos == 0:
        logging.warning(
            "Nenhum jogo retornou um preço válido nesta rodada. "
            "O histórico existente será mantido e regravado sem alterações."
        )

    salvar_historico(historico)
    return {"total": total, "sucesso": sucessos, "falha": falhas}


def salvar_jogos_monitorados(app_ids):
    """
    Grava a lista de jogos monitorados em jogos_monitorados.json.

    Devolve True se conseguiu gravar e False caso contrário.
    """
    try:
        with open(ARQUIVO_JOGOS_MONITORADOS, "w", encoding="utf-8") as arquivo:
            json.dump(app_ids, arquivo, ensure_ascii=False, indent=2)
    except OSError as erro:
        logging.error(
            f"Não foi possível salvar {ARQUIVO_JOGOS_MONITORADOS}: {erro}"
        )
        return False
    return True


def adicionar_jogo(app_ids, app_id, nome):
    """
    Adiciona um jogo à lista e grava o arquivo imediatamente.

    Recusa app_ids já presentes (sem duplicar nem regravar). Devolve
    True quando o jogo foi adicionado e False quando foi recusado.
    """
    for jogo in app_ids:
        if jogo.get("app_id") == app_id:
            logging.warning(
                f"app_id {app_id} já está na lista de jogos monitorados."
            )
            return False
    app_ids.append({"app_id": app_id, "nome": nome})
    salvar_jogos_monitorados(app_ids)
    return True


def remover_jogo(app_ids, app_id):
    """
    Remove um jogo da lista pelo app_id e grava o arquivo imediatamente.

    Se o app_id não estiver na lista, nada é alterado. Devolve o item
    removido, ou None quando o app_id não existe na lista.
    """
    for jogo in app_ids:
        if jogo.get("app_id") == app_id:
            app_ids.remove(jogo)
            salvar_jogos_monitorados(app_ids)
            return jogo
    logging.warning(f"app_id {app_id} não está na lista de jogos monitorados.")
    return None


def carregar_offset():
    """
    Lê o último update_id do Telegram já processado, de telegram_offset.json.

    Evita reprocessar mensagens antigas toda vez que o programa roda.
    Se o arquivo ainda não existir, começa do zero (processa tudo).
    """
    try:
        with open(ARQUIVO_OFFSET_TELEGRAM, "r", encoding="utf-8") as arquivo:
            telegram_offset = json.load(arquivo)
    except FileNotFoundError:
        telegram_offset = {"ultimo_update_id": 0}
    return telegram_offset


def salvar_offset(offset):
    """Grava o dicionário de offset em telegram_offset.json."""
    with open(ARQUIVO_OFFSET_TELEGRAM, "w", encoding="utf-8") as arquivo:
        json.dump(offset, arquivo)


def buscar_mensagens_novas():
    """
    Busca mensagens novas do Telegram, a partir do offset salvo.

    Usa offset + 1 porque o Telegram devolveria de novo a própria
    mensagem do último update_id se pedíssemos exatamente esse valor.
    """
    codigo = carregar_config_telegram()
    token = codigo["token"]
    offset = carregar_offset()

    url_base = "https://api.telegram.org/bot" + token + "/getUpdates?"
    parametros = {"offset": offset["ultimo_update_id"] + 1} # +1 evita repetir a última mensagem já processada
    query = urllib.parse.urlencode(parametros)
    url_final = url_base + query

    resposta = urllib.request.urlopen(url_final)
    conteudo_bruto = resposta.read()
    decodificado = conteudo_bruto.decode("utf-8")
    dados = json.loads(decodificado)

    return dados["result"]


def _interpretar_app_id(partes, nome_comando):
    """
    Converte o argumento de um comando (/add, /remove) em inteiro.

    `partes` é o texto do comando já dividido por espaços. Devolve
    uma tupla (app_id, None) em caso de sucesso ou (None, mensagem)
    quando faltar o argumento ou ele não for um inteiro — sem nunca
    lançar exceção.
    """
    if len(partes) < 2 or not partes[1].strip():
        return None, (
            f"Comando {nome_comando} precisa vir com um número inteiro. "
            f"Exemplo: {nome_comando} 730"
        )
    try:
        return int(partes[1].strip()), None
    except ValueError:
        return None, (
            f"Comando {nome_comando} precisa vir com um número inteiro. "
            f"Exemplo: {nome_comando} 730"
        )


def processar_comandos(app_ids):
    """
    Lê mensagens novas do Telegram e executa comandos nelas.

    Comandos suportados: /add <app_id>, /remove <app_id>, /list.
    Modifica app_ids diretamente (a lista é mutável) e salva o offset
    do update_id mais recente ao final, para não reprocessar depois.

    Cada mensagem é tratada isoladamente: um comando malformado ou
    uma falha em uma mensagem não interrompe as demais.
      - /add sem argumento ou com valor não inteiro: avisa o uso
        correto e não altera a lista;
      - /add de app_id já monitorado: recusa, sem duplicar;
      - /remove de app_id ausente: avisa e não altera a lista;
      - toda alteração bem-sucedida é gravada na hora.
    """
    try:
        mensagens = buscar_mensagens_novas()
    except Exception as erro:  # noqa: BLE001 - falha no Telegram não derruba o programa
        logging.error(f"Não foi possível buscar mensagens do Telegram: {erro}")
        return

    ids_processados = []
    for mensagem in mensagens:
        try:
            ids_processados.append(mensagem["update_id"])
            texto = mensagem["message"]["text"]
        except (KeyError, TypeError) as erro:
            logging.warning(f"Mensagem do Telegram em formato inesperado ignorada: {erro}")
            continue
        print(f"Comando recebido: {texto}")

        try:
            if texto.startswith("/add"):
                partes = texto.split()
                app_id_numero, erro_uso = _interpretar_app_id(partes, "/add")
                if erro_uso is not None:
                    print(erro_uso)
                    logging.warning(erro_uso)
                    continue

                if any(jogo.get("app_id") == app_id_numero for jogo in app_ids):
                    mensagem_duplicado = (
                        f"O app_id {app_id_numero} já está na sua lista; não foi adicionado."
                    )
                    print(mensagem_duplicado)
                    logging.warning(mensagem_duplicado)
                    continue

                nome_encontrado = buscar_nome_jogo(app_id_numero)
                if nome_encontrado is not None:
                    adicionar_jogo(app_ids, app_id_numero, nome_encontrado)
                    print(f"{nome_encontrado} adicionado via Telegram!")
                else:
                    print("Não foi possível encontrar esse app_id.")
            elif texto.startswith("/remove"):
                partes = texto.split()
                app_id_numero, erro_uso = _interpretar_app_id(partes, "/remove")
                if erro_uso is not None:
                    print(erro_uso)
                    logging.warning(erro_uso)
                    continue

                removido = remover_jogo(app_ids, app_id_numero)
                if removido is not None:
                    print(f"{removido['nome']} removido via Telegram!")
                else:
                    print("Esse app_id não está na sua lista.")
            elif texto.startswith("/list"):
                if not app_ids:
                    enviar_notificacao("Nenhum jogo monitorado ainda.")
                else:
                    lista_texto = ""
                    for jogo in app_ids:
                        lista_texto = lista_texto + f"{jogo['app_id']} - {jogo['nome']}\n"
                    enviar_notificacao(lista_texto)
        except Exception as erro:  # noqa: BLE001 - uma mensagem problemática não trava as outras
            logging.error(f"Erro ao processar mensagem '{texto}': {erro}")
            continue

    if ids_processados:
        novo_offset = {"ultimo_update_id": max(ids_processados)}
        salvar_offset(novo_offset)


def main():
    """Ponto de entrada: carrega os dados, processa comandos e executa."""
    app_ids = carregar_jogos_monitorados()
    historico = carregar_historico()
    processar_comandos(app_ids)

    # GITHUB_ACTIONS existe automaticamente nas execuções do workflow;
    # nesse modo, roda só a varredura (sem menu, já que não há alguém digitando)
    if os.environ.get("GITHUB_ACTIONS"):
        rodar_varredura(app_ids, historico)
    else:
        while True:
            print("=====Steam Price Tracker=====")
            escolha = input("[1] - Ver preços\n[2] - Adicionar jogo\n[3] - Remover jogo\n[4] - Listar jogos monitorados\n[5] - Ver histórico de um jogo\n[6] - Sair\nEscolha uma opção: ").strip()

            if escolha == "1":
                rodar_varredura(app_ids, historico)
                print("Varredura concluída.")
            elif escolha == "2":
                texto_digitado = input("Digite o(s) app_id(s) que você quer adicionar (separados por vírgula): ")
                pedacos = texto_digitado.split(",")
                for pedaco in pedacos:
                    try:
                        adicionar_app_id = int(pedaco.strip())
                    except ValueError:
                        print("App_Id inválido! Use um número inteiro. Exemplo: 730")
                        continue
                    if any(jogo.get("app_id") == adicionar_app_id for jogo in app_ids):
                        print(
                            f"O app_id {adicionar_app_id} já está na sua lista; "
                            "não foi adicionado."
                        )
                        continue
                    nome_encontrado = buscar_nome_jogo(adicionar_app_id)
                    if nome_encontrado is not None:
                        adicionar_jogo(app_ids, adicionar_app_id, nome_encontrado)
                        print(f"{nome_encontrado} adicionado com sucesso!")
                    else:
                        print("Não foi possível encontrar esse app_id.")
            elif escolha == "3":
                try:
                    remover_jogo_id = int(input("Digite o app_id que você quer remover: "))
                except ValueError:
                    print("App_Id inválido! Use um número inteiro. Exemplo: 730")
                    continue
                removido = remover_jogo(app_ids, remover_jogo_id)
                if removido is not None:
                    print("Jogo removido com sucesso!")
                else:
                    print("O app_id não foi encontrado em sua lista.")
            elif escolha == "4":
                if not app_ids:
                    print("Nenhum jogo monitorado ainda.")
                else:
                    for jogo in app_ids:
                        print(f"{jogo['app_id']} - {jogo['nome']}")
            elif escolha == "5":
                nome_jogo = input("Digite o nome do jogo que você quer ver o histórico: ")
                lista_precos = _historico_do_jogo_valido(historico, nome_jogo)
                if lista_precos:
                    print(lista_precos)
                else:
                    print("Não há histórico para esse nome.")
            elif escolha == "6":
                print("Saindo...")
                break
            else:
                print("Opção inválida")


if __name__ == "__main__":
    main()
