import pandas as pd

def process(download_url):
    df = pd.read_csv(download_url)
    url_wo_sig = download_url[:download_url.find('?')]
    table_name = url_wo_sig[url_wo_sig.rfind('/') + 1 : url_wo_sig.rfind('.')]
    of = pd.DataFrame([table_name, i] for i in df.columns)
    of.columns = ['table_name', 'column_name']
    return of
