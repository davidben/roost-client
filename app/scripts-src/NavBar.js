(function() {
  var __bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; },
    __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; };

  (function() {
    return com.roost.NavBar = (function(_super) {
      __extends(NavBar, _super);

      function NavBar() {
        this._hideHelp = __bind(this._hideHelp, this);
        this._openHelp = __bind(this._openHelp, this);
        this._toggleSubs = __bind(this._toggleSubs, this);
        this._toggleKeyboard = __bind(this._toggleKeyboard, this);
        this._togglePanes = __bind(this._togglePanes, this);
        this._addPersonalMessagePane = __bind(this._addPersonalMessagePane, this);
        this._addPane = __bind(this._addPane, this);
        this._handleLogout = __bind(this._handleLogout, this);
        this.render = __bind(this.render, this);
        this.initialize = __bind(this.initialize, this);
        return NavBar.__super__.constructor.apply(this, arguments);
      }

      NavBar.prototype.className = 'navbar';

      NavBar.prototype.events = function() {
        var eventsHash;
        eventsHash = {};
        eventsHash["" + com.roost.CLICK_EVENT + " .logout"] = '_handleLogout';
        eventsHash["" + com.roost.CLICK_EVENT + " .add-pane"] = '_addPane';
        eventsHash["" + com.roost.CLICK_EVENT + " .personal-message"] = '_addPersonalMessagePane';
        eventsHash["" + com.roost.CLICK_EVENT + " .user-info"] = '_toggleSubs';
        eventsHash["" + com.roost.CLICK_EVENT + " .help"] = '_openHelp';
        eventsHash["" + com.roost.CLICK_EVENT + " .toggle-panes"] = '_togglePanes';
        eventsHash["" + com.roost.CLICK_EVENT + " .toggle-keyboard"] = '_toggleKeyboard';
        return eventsHash;
      };

      NavBar.prototype.initialize = function(options) {
        this.session = options.session;
        this.userInfo = this.session.userInfo;
        this.settings = this.session.settingsModel;
        this.listenTo(this.userInfo, 'change', this.render);
        return this.listenTo(this.settings, 'change:showNavbar', this.render);
      };

      NavBar.prototype.render = function() {
        var gravatar, template;
        this.$el.empty();
        template = com.roost.templates['NavBar'];
        if (this.userInfo.get('username') != null) {
          gravatar = getGravatarFromName(this.userInfo.get('username'), this.userInfo.get('realm'), 100);
        }
        if (!this.settings.get('showNavbar')) {
          this.$el.addClass('hidden');
        } else {
          this.$el.removeClass('hidden');
        }
        return this.$el.append(template(_.defaults({
          loggedIn: this.userInfo.get('username') != null,
          gravatar: gravatar
        }, this.userInfo.attributes, this.settings.attributes)));
      };

      NavBar.prototype._handleLogout = function() {
        return this.userInfo.trigger('logout');
      };

      NavBar.prototype._addPane = function() {
        return this.session.addPane({});
      };

      NavBar.prototype._addPersonalMessagePane = function() {
        return this.session.addPane({
          filters: {
            class_key_base: 'message',
            is_personal: true
          }
        });
      };

      NavBar.prototype._togglePanes = function() {
        return this.settings.set('panes', !this.settings.get('panes'));
      };

      NavBar.prototype._toggleKeyboard = function() {
        return this.settings.set('keyboard', !this.settings.get('keyboard'));
      };

      NavBar.prototype._toggleSubs = function() {
        return this.settings.set('showSubs', !this.settings.get('showSubs'));
      };

      NavBar.prototype._openHelp = function() {
        if ($('.modal-overlay').length === 0) {
          $('body').append(com.roost.templates['HotkeyHelp']({}));
          return $('.close-help').click(this._hideHelp);
        }
      };

      NavBar.prototype._hideHelp = function() {
        $('.modal-overlay').remove();
        return $('.modal').remove();
      };

      return NavBar;

    })(Backbone.View);
  })();

}).call(this);
