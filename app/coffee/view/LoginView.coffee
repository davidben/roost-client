do ->
  class com.roost.LoginView extends Backbone.View
    className: 'login-view'

    events: ->
      eventsHash = {}
      eventsHash["#{com.roost.CLICK_EVENT} .login"] = '_handleLogin'
      return eventsHash

    initialize: (options) =>
      @userInfo = options.userInfo
      @listenTo @userInfo, 'change', @render

    render: =>
      @$el.empty()
      if @userInfo.get('username')?
        @$el.hide()
      else
        @$el.show()
        template = com.roost.templates['LoginView']
        @$el.append template({})

    _handleLogin: =>
      # Trigger the model, AuthenticationController will handle it
      @userInfo.trigger 'login'