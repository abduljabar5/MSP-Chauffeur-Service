export const handler = async function (event, context) {
  return {
    statusCode: 200,
    body: JSON.stringify({
      googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY,
    }),
  };
}; 