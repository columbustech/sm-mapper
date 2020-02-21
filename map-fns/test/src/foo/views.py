from django.views.decorators.csrf import csrf_exempt

from rest_framework.parsers import JSONParser
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework import status

from .process import *

class ProcessView(APIView):
    parser_class = (JSONParser,)

    @csrf_exempt
    def post(self, request): 
        downloadUrl = request.data['downloadUrl']
        df = process(downloadUrl)
        return Response({"output": df.to_dict('records')}, status=status.HTTP_200_OK)
